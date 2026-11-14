import AVFAudio
import Capacitor
import Foundation

let recordingFileLock = NSRecursiveLock()

struct RecordingManifest: Codable {
    let id: String
    let caregiverId: Int
    let date: String
    var sessionId: String? = nil
    var nextChunkIndex: Int = 0
    var segmentCount: Int = 0
    var stopped: Bool = false
    var durationSeconds: Double = 0
    var uploaded: Bool = false
    var confirmedChunkIndexes: [Int]? = nil
    var uploadCompleted: Bool? = nil
    var uploadError: String? = nil
}

enum RecordingStore {
    static func root(_ caregiverId: Int) throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent("RecordingSegments", isDirectory: true)
            .appendingPathComponent(String(caregiverId), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var protectedDirectory = directory
        try protectedDirectory.setResourceValues(values)
        return directory
    }

    static func directory(_ caregiverId: Int, _ id: String) throws -> URL {
        try root(caregiverId).appendingPathComponent(id.lowercased(), isDirectory: true)
    }

    static func segment(_ directory: URL, _ index: Int) -> URL {
        directory.appendingPathComponent(String(format: "chunk_%06d.wav", index))
    }

    static func load(_ directory: URL) throws -> RecordingManifest {
        try JSONDecoder().decode(RecordingManifest.self,
                                 from: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
    }

    static func save(_ manifest: RecordingManifest, _ directory: URL) throws {
        let url = directory.appendingPathComponent("manifest.json")
        try JSONEncoder().encode(manifest).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                              ofItemAtPath: url.path)
    }
}

@objc(SegmentedAudioPlugin)
public class SegmentedAudioPlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    public let identifier = "SegmentedAudioPlugin"
    public let jsName = "SegmentedAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingUploads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureUploader", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncUploads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardRecording", returnType: CAPPluginReturnPromise)
    ]

    private typealias Manifest = RecordingManifest

    private let lock = recordingFileLock
    private let segmentSeconds = 3.0
    private var engine: AVAudioEngine?
    private var currentFile: AVAudioFile?
    private var currentDirectory: URL?
    private var currentManifest: Manifest?
    private var framesInSegment: AVAudioFramePosition = 0
    private var totalFrames: AVAudioFramePosition = 0
    private var sampleRate: Double = 0
    private var interrupted = false
    private var interruptedRecordingID: String?
    private var captureFailure: String?

    override public func load() {
        IOSRecordingUploader.shared.start()
        NotificationCenter.default.addObserver(
            self, selector: #selector(audioInterrupted(_:)),
            name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance()
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(recordingUploadCompleted(_:)),
            name: .ellaRecordingUploadCompleted, object: nil
        )
    }

    @objc private func recordingUploadCompleted(_ notification: Notification) {
        guard let manifest = notification.object as? Manifest else { return }
        notifyListeners("recordingStateChanged", data: ["status": "uploaded", "latestRecording": summary(manifest)])
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func caregiver(_ call: CAPPluginCall) -> Int? {
        guard let id = call.getInt("caregiverId"), id > 0 else { return nil }
        return id
    }

    private func root(_ caregiverId: Int) throws -> URL {
        try RecordingStore.root(caregiverId)
    }

    private func folder(_ call: CAPPluginCall) throws -> URL {
        guard let caregiverId = caregiver(call), let id = call.getString("id"), UUID(uuidString: id) != nil else {
            throw NSError(domain: "SegmentedAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Recording not found."])
        }
        return try root(caregiverId).appendingPathComponent(id.lowercased(), isDirectory: true)
    }

    private func manifestURL(_ directory: URL) -> URL { directory.appendingPathComponent("manifest.json") }
    private func segmentURL(_ directory: URL, _ index: Int) -> URL {
        RecordingStore.segment(directory, index)
    }

    private func load(_ directory: URL) throws -> Manifest {
        try RecordingStore.load(directory)
    }

    private func save(_ manifest: Manifest, _ directory: URL) throws {
        try RecordingStore.save(manifest, directory)
    }

    private func target(_ call: CAPPluginCall) throws -> (URL, Manifest) {
        let directory = try folder(call)
        let manifest = try load(directory)
        guard manifest.caregiverId == caregiver(call), manifest.id == call.getString("id")?.lowercased() else {
            throw NSError(domain: "SegmentedAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Recording account mismatch."])
        }
        return (directory, manifest)
    }

    private func summary(_ manifest: Manifest) -> [String: Any] {
        ["id": manifest.id, "date": manifest.date, "format": "standalone",
         "sessionId": manifest.sessionId as Any? ?? NSNull(), "nextChunkIndex": manifest.nextChunkIndex,
         "segmentCount": manifest.segmentCount, "stopped": manifest.stopped,
         "durationSeconds": manifest.durationSeconds, "uploaded": manifest.uploaded,
         "uploadCompleted": manifest.uploadCompleted ?? false,
         "uploadError": manifest.uploadError as Any? ?? NSNull()]
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call), let date = call.getString("date"),
              date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            call.reject("A caregiver and recording date are required.")
            return
        }
        let begin = { [weak self] (granted: Bool) in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted else { call.reject("Microphone access is required."); return }
                self.begin(call, caregiverId: caregiverId, date: date)
            }
        }
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: begin)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(begin)
        }
    }

    private func begin(_ call: CAPPluginCall, caregiverId: Int, date: String) {
        lock.lock(); defer { lock.unlock() }
        guard engine == nil else { call.reject("A recording is already in progress."); return }
        var directory: URL?
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .default)
            try audioSession.setActive(true)
            let id = UUID().uuidString.lowercased()
            let newDirectory = try root(caregiverId).appendingPathComponent(id, isDirectory: true)
            directory = newDirectory
            try FileManager.default.createDirectory(at: newDirectory, withIntermediateDirectories: false)
            let manifest = Manifest(id: id, caregiverId: caregiverId, date: date)
            try save(manifest, newDirectory)
            let nextEngine = AVAudioEngine()
            let input = nextEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "SegmentedAudio", code: 3) }
            currentManifest = manifest
            currentDirectory = newDirectory
            sampleRate = format.sampleRate
            totalFrames = 0
            framesInSegment = 0
            interrupted = false
            interruptedRecordingID = nil
            captureFailure = nil
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                self?.append(buffer, format: format)
            }
            do { try nextEngine.start() } catch { input.removeTap(onBus: 0); throw error }
            engine = nextEngine
            call.resolve(["status": "recording"])
            notifyListeners("recordingStateChanged", data: ["status": "recording", "elapsedSeconds": 0])
        } catch {
            currentManifest = nil
            currentDirectory = nil
            currentFile = nil
            if let directory { try? FileManager.default.removeItem(at: directory) }
            try? AVAudioSession.sharedInstance().setActive(false)
            call.reject(error.localizedDescription, nil, error)
        }
    }

    private func append(_ buffer: AVAudioPCMBuffer, format: AVAudioFormat) {
        lock.lock(); defer { lock.unlock() }
        guard engine != nil, let directory = currentDirectory, currentManifest != nil,
              buffer.frameLength > 0 else { return }
        do {
            var manifest = try load(directory)
            if currentFile == nil {
                let url = segmentURL(directory, manifest.segmentCount)
                let settings: [String: Any] = [
                    AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: format.sampleRate,
                    AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
                ]
                currentFile = try AVAudioFile(forWriting: url, settings: settings,
                                              commonFormat: format.commonFormat, interleaved: format.isInterleaved)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                      ofItemAtPath: url.path)
            }
            try currentFile?.write(from: buffer)
            framesInSegment += AVAudioFramePosition(buffer.frameLength)
            totalFrames += AVAudioFramePosition(buffer.frameLength)
            if Double(framesInSegment) / sampleRate >= segmentSeconds {
                currentFile = nil
                framesInSegment = 0
                manifest.segmentCount += 1
                manifest.durationSeconds = Double(totalFrames) / sampleRate
                try save(manifest, directory)
                currentManifest = manifest
                DispatchQueue.main.async { [weak self] in
                    self?.notifyListeners("recordingStateChanged", data: ["status": "recording",
                        "elapsedSeconds": manifest.durationSeconds])
                    IOSRecordingUploader.shared.kick(caregiverId: manifest.caregiverId)
                }
            }
        } catch {
            captureFailure = "Microphone recording failed: \(error.localizedDescription)"
            DispatchQueue.main.async { [weak self] in self?.finish(interrupted: true) }
        }
    }

    @discardableResult
    private func finish(interrupted wasInterrupted: Bool) -> Manifest? {
        guard let active = engine else { return nil }
        active.inputNode.removeTap(onBus: 0)
        active.stop()
        lock.lock(); defer { lock.unlock() }
        engine = nil
        currentFile = nil
        let directory = currentDirectory
        let savedManifest = directory.flatMap { try? load($0) }
        currentDirectory = nil
        currentManifest = nil
        guard let directory, var manifest = savedManifest else {
            framesInSegment = 0
            interrupted = true
            interruptedRecordingID = nil
            let message = captureFailure ?? "Recording metadata was lost. Please try again."
            captureFailure = message
            if let directory { try? FileManager.default.removeItem(at: directory) }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            notifyListeners("recordingStateChanged", data: ["status": "interrupted",
                "error": message, "elapsedSeconds": 0])
            return nil
        }
        if framesInSegment > 0 {
            manifest.segmentCount += 1
            manifest.durationSeconds = Double(totalFrames) / sampleRate
        }
        manifest.stopped = true
        framesInSegment = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if manifest.segmentCount == 0 {
            try? FileManager.default.removeItem(at: directory)
            interrupted = wasInterrupted
            interruptedRecordingID = nil
            if wasInterrupted {
                notifyListeners("recordingStateChanged", data: ["status": "interrupted",
                    "error": captureFailure ?? "No audio was captured. Please try again.", "elapsedSeconds": 0])
            }
            return nil
        }
        do { try save(manifest, directory) } catch {
            interrupted = true
            interruptedRecordingID = nil
            let message = "Unable to save the recording: \(error.localizedDescription)"
            captureFailure = message
            notifyListeners("recordingStateChanged", data: ["status": "interrupted",
                "error": message, "elapsedSeconds": manifest.durationSeconds])
            return nil
        }
        interrupted = wasInterrupted
        interruptedRecordingID = wasInterrupted ? manifest.id : nil
        notifyListeners("recordingStateChanged", data: ["status": wasInterrupted ? "interrupted" : "saved",
            "recording": summary(manifest), "elapsedSeconds": manifest.durationSeconds,
            "error": wasInterrupted ? captureFailure ?? "Recording was interrupted." : ""])
        IOSRecordingUploader.shared.kick(caregiverId: manifest.caregiverId)
        return manifest
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let caregiverId = self.caregiver(call),
                  self.currentManifest?.caregiverId == caregiverId else { call.reject("No recording is in progress."); return }
            guard let manifest = self.finish(interrupted: false) else {
                call.reject(self.captureFailure ?? "No audio was captured. Please try again.")
                return
            }
            call.resolve(["status": "saved", "recording": self.summary(manifest)])
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call) else { call.reject("A caregiver account is required."); return }
        lock.lock(); defer { lock.unlock() }
        if let manifest = currentManifest, manifest.caregiverId == caregiverId {
            call.resolve(["status": "recording", "elapsedSeconds": Double(totalFrames) / sampleRate])
            return
        }
        let latest = (try? manifests(caregiverId).last)?.1
        let currentInterrupted = interrupted && (latest?.id == interruptedRecordingID ||
            (latest == nil && interruptedRecordingID == nil))
        var result: [String: Any] = ["status": currentInterrupted ? "interrupted" : "idle", "elapsedSeconds": 0]
        if currentInterrupted { result["error"] = captureFailure ?? "Recording was interrupted." }
        if let latest {
            result["status"] = currentInterrupted ? "interrupted" : "saved"
            result["elapsedSeconds"] = latest.durationSeconds
            result["latestRecording"] = summary(latest)
        }
        call.resolve(result)
    }

    private func manifests(_ caregiverId: Int) throws -> [(URL, Manifest)] {
        let directories = try FileManager.default.contentsOfDirectory(at: root(caregiverId), includingPropertiesForKeys: nil)
        return directories.filter(\.hasDirectoryPath).compactMap { directory in
            guard let manifest = try? load(directory), manifest.caregiverId == caregiverId else { return nil }
            return (directory, manifest)
        }.sorted {
            let left = (try? manifestURL($0.0).resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let right = (try? manifestURL($1.0).resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return left < right
        }
    }

    @objc func getPendingUploads(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call) else { call.reject("A caregiver account is required."); return }
        lock.lock(); defer { lock.unlock() }
        do {
            var pending: [[String: Any]] = []
            var unreadableCount = 0
            var cleanupFailureCount = 0
            for (directory, original) in try manifests(caregiverId) {
                var manifest = original
                // Enumerated directory URLs may not equal the URL used at creation time.
                let isActive = engine != nil && currentManifest?.id == manifest.id
                if manifest.uploaded || manifest.uploadCompleted == true {
                    if !manifest.uploaded {
                        manifest.uploaded = true
                        do { try save(manifest, directory) }
                        catch { cleanupFailureCount += 1; continue }
                    }
                    do { try FileManager.default.removeItem(at: directory) }
                    catch { cleanupFailureCount += 1 }
                    continue
                }
                if !manifest.stopped && !isActive {
                    try? FileManager.default.removeItem(at: segmentURL(directory, manifest.segmentCount))
                    manifest.stopped = true
                    try save(manifest, directory)
                }
                if manifest.stopped && manifest.segmentCount == 0 && !isActive {
                    try? FileManager.default.removeItem(at: directory)
                    continue
                }
                if manifest.nextChunkIndex > manifest.segmentCount { unreadableCount += 1; continue }
                pending.append(summary(manifest))
            }
            call.resolve(["recordings": pending, "unreadableCount": unreadableCount,
                          "cleanupFailureCount": cleanupFailureCount])
        } catch { call.reject("Unable to read saved recordings.", nil, error) }
    }

    @objc func configureUploader(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call), let baseURL = call.getString("apiBase"),
              IOSRecordingUploader.shared.configure(baseURL: baseURL) else {
            call.reject("A valid recording API URL is required.")
            return
        }
        IOSRecordingUploader.shared.kick(caregiverId: caregiverId)
        call.resolve()
    }

    @objc func syncUploads(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call) else { call.reject("A caregiver account is required."); return }
        IOSRecordingUploader.shared.kick(caregiverId: caregiverId)
        call.resolve()
    }

    @objc func pauseUpload(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call), let id = call.getString("id"), UUID(uuidString: id) != nil else {
            call.reject("Recording not found."); return
        }
        IOSRecordingUploader.shared.pause(caregiverId: caregiverId, recordingId: id.lowercased())
        call.resolve()
    }

    @objc func resumeUpload(_ call: CAPPluginCall) {
        guard let caregiverId = caregiver(call), let id = call.getString("id"), UUID(uuidString: id) != nil else {
            call.reject("Recording not found."); return
        }
        IOSRecordingUploader.shared.resume(caregiverId: caregiverId, recordingId: id.lowercased())
        call.resolve()
    }

    @objc func discardRecording(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        do {
            let (directory, manifest) = try target(call)
            guard manifest.stopped, currentManifest?.id != manifest.id,
                  manifest.sessionId == call.getString("sessionId") else {
                throw failure("Recording cannot be discarded while active or after its session changes.")
            }
            var discarded = manifest
            discarded.uploaded = true
            try save(discarded, directory)
            try FileManager.default.removeItem(at: directory)
            if interruptedRecordingID == manifest.id {
                interrupted = false
                interruptedRecordingID = nil
                captureFailure = nil
            }
            call.resolve()
        } catch { call.reject(error.localizedDescription, nil, error) }
    }

    private func failure(_ text: String) -> NSError {
        NSError(domain: "SegmentedAudio", code: 4, userInfo: [NSLocalizedDescriptionKey: text])
    }

    @objc private func audioInterrupted(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        // The interrupted audio session cannot guarantee a gapless resume. Seal what we have;
        // upload sync will complete this recording when the app is able to run.
        DispatchQueue.main.async { [weak self] in self?.finish(interrupted: true) }
    }
}
