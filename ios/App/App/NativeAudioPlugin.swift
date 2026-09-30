import AVFAudio
import Capacitor
import Foundation

@objc(NativeAudioPlugin)
public class NativeAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate, @unchecked Sendable {
    public let identifier = "NativeAudioPlugin"
    public let jsName = "NativeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingUploads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUploadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readUploadChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmUploadChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetUploadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteUploadedRecording", returnType: CAPPluginReturnPromise)
    ]

    private struct UploadManifest: Codable {
        let id: String
        let caregiverId: Int
        let date: String
        var sessionId: String?
        var uploadedBytes: Int64
        var nextChunkIndex: Int
        var uploaded: Bool
    }

    private let uploadChunkSize = 256 * 1024

    private var recorder: AVAudioRecorder?
    private var recordingCaregiverId: Int?
    private var interruptedCaregiverId: Int?

    private func recordingID(_ call: CAPPluginCall) -> String? {
        guard let id = call.getString("id"), let uuid = UUID(uuidString: id) else { return nil }
        return uuid.uuidString.lowercased()
    }

    private func caregiverID(_ call: CAPPluginCall) -> Int? {
        guard let id = call.getInt("caregiverId"), id > 0 else { return nil }
        return id
    }

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let caregiverId = self.caregiverID(call) else {
                call.reject("A caregiver account is required.")
                return
            }
            guard let date = call.getString("date"),
                  date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
                call.reject("A recording date is required.")
                return
            }
            if let active = self.recorder, !active.isRecording {
                self.finishRecording(interrupted: true)
            }
            guard self.recorder == nil else {
                call.reject("A recording is already in progress.")
                return
            }

            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        self.beginRecording(call, caregiverId: caregiverId, date: date, granted: granted)
                    }
                }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        self.beginRecording(call, caregiverId: caregiverId, date: date, granted: granted)
                    }
                }
            }
        }
    }

    private func beginRecording(_ call: CAPPluginCall, caregiverId: Int, date: String, granted: Bool) {
        guard granted else {
            call.reject("Microphone access is required. Enable it in iPhone Settings.")
            return
        }
        guard recorder == nil else {
            call.reject("A recording is already in progress.")
            return
        }

        var fileURL: URL?
        var manifestURL: URL?
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .default)
            try audioSession.setActive(true)

            let directory = try recordingsDirectory(for: caregiverId)
            let url = directory.appendingPathComponent(UUID().uuidString.lowercased()).appendingPathExtension("m4a")
            fileURL = url
            manifestURL = self.manifestURL(for: url)
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 96_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            let audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder.delegate = self
            guard audioRecorder.prepareToRecord() else {
                throw NSError(domain: "NativeAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to prepare audio recording."])
            }
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
            try saveManifest(UploadManifest(
                id: url.deletingPathExtension().lastPathComponent,
                caregiverId: caregiverId,
                date: date,
                sessionId: nil,
                uploadedBytes: 0,
                nextChunkIndex: 0,
                uploaded: false
            ), for: url)
            guard audioRecorder.record() else {
                throw NSError(domain: "NativeAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to start audio recording."])
            }

            recorder = audioRecorder
            recordingCaregiverId = caregiverId
            interruptedCaregiverId = nil
            call.resolve(["status": "recording"])
            notifyListeners("recordingStateChanged", data: ["status": "recording", "elapsedSeconds": 0])
        } catch {
            if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
            if let manifestURL { try? FileManager.default.removeItem(at: manifestURL) }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.recorder != nil else {
                call.reject("No recording is in progress.")
                return
            }
            guard self.caregiverID(call) == self.recordingCaregiverId else {
                call.reject("This recording belongs to another caregiver.")
                return
            }
            if let recording = self.finishRecording(interrupted: false) {
                call.resolve(["status": "saved", "recording": recording])
            } else {
                call.reject("No audio was captured. Please try again.")
            }
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let caregiverId = self.caregiverID(call) else {
                call.reject("A caregiver account is required.")
                return
            }
            if let active = self.recorder, !active.isRecording {
                self.finishRecording(interrupted: true)
            }
            if self.recorder != nil && self.recordingCaregiverId != caregiverId {
                self.finishRecording(interrupted: true)
            }
            var result: [String: Any] = [
                "status": self.recorder != nil ? "recording" : (self.interruptedCaregiverId == caregiverId ? "interrupted" : "idle"),
                "elapsedSeconds": self.recorder?.currentTime ?? 0
            ]
            if self.recorder == nil, let latest = self.latestRecording(for: caregiverId) {
                result["latestRecording"] = latest
                result["elapsedSeconds"] = latest["durationSeconds"]
                if self.interruptedCaregiverId != caregiverId { result["status"] = "saved" }
            }
            call.resolve(result)
        }
    }

    @objc func getPendingUploads(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let caregiverId = self.caregiverID(call) else {
                call.reject("A caregiver account is required.")
                return
            }
            do {
                let directory = try self.recordingsDirectory(for: caregiverId)
                let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                var unreadableCount = 0
                var cleanupFailureCount = 0
                let pending = files.filter { $0.pathExtension == "json" }.compactMap { sidecar -> [String: Any]? in
                    let audio = sidecar.deletingPathExtension().appendingPathExtension("m4a")
                    guard audio != self.recorder?.url else { return nil }
                    guard let manifest = self.loadManifest(for: audio),
                          manifest.caregiverId == caregiverId,
                          manifest.id == audio.deletingPathExtension().lastPathComponent else {
                        unreadableCount += 1
                        return nil
                    }
                    if manifest.uploaded {
                        do {
                            try self.removeUploadedFiles(for: audio)
                        } catch {
                            cleanupFailureCount += 1
                        }
                        return nil
                    }
                    guard let info = self.metadata(for: audio) else {
                        unreadableCount += 1
                        return nil
                    }
                    return [
                        "id": manifest.id,
                        "date": manifest.date,
                        "sessionId": manifest.sessionId as Any? ?? NSNull(),
                        "uploadedBytes": manifest.uploadedBytes,
                        "nextChunkIndex": manifest.nextChunkIndex,
                        "sizeBytes": info["sizeBytes"] ?? 0,
                        "durationSeconds": info["durationSeconds"] ?? 0
                    ]
                }
                call.resolve([
                    "recordings": pending.sorted { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") },
                    "unreadableCount": unreadableCount,
                    "cleanupFailureCount": cleanupFailureCount
                ])
            } catch {
                call.reject("Unable to read saved recordings.", nil, error)
            }
        }
    }

    @objc func setUploadSession(_ call: CAPPluginCall) {
        updateManifest(call) { manifest, _ in
            guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty,
                  manifest.sessionId == nil || manifest.sessionId == sessionId else {
                throw self.uploadError("Recording session mismatch.")
            }
            manifest.sessionId = sessionId
        }
    }

    @objc func readUploadChunk(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let target = self.uploadTarget(call) else { return }
            let (manifest, url) = target
            guard !manifest.uploaded, manifest.sessionId != nil else {
                call.reject("Recording is not ready to upload.")
                return
            }
            do {
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(manifest.uploadedBytes))
                guard let chunk = try handle.read(upToCount: self.uploadChunkSize), !chunk.isEmpty else {
                    call.reject("No audio bytes remain to upload.")
                    return
                }
                call.resolve([
                    "base64": chunk.base64EncodedString(),
                    "byteCount": chunk.count,
                    "chunkIndex": manifest.nextChunkIndex
                ])
            } catch {
                call.reject("Unable to read saved audio.", nil, error)
            }
        }
    }

    @objc func confirmUploadChunk(_ call: CAPPluginCall) {
        updateManifest(call) { manifest, url in
            guard !manifest.uploaded,
                  manifest.sessionId == call.getString("sessionId"),
                  manifest.nextChunkIndex == call.getInt("chunkIndex"),
                  let byteCount = call.getInt("byteCount"), byteCount > 0,
                  let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber,
                  manifest.uploadedBytes + Int64(byteCount) <= size.int64Value else {
                throw self.uploadError("Upload progress mismatch.")
            }
            manifest.uploadedBytes += Int64(byteCount)
            manifest.nextChunkIndex += 1
        }
    }

    @objc func resetUploadSession(_ call: CAPPluginCall) {
        updateManifest(call) { manifest, _ in
            guard !manifest.uploaded else { throw self.uploadError("Recording is already uploaded.") }
            manifest.sessionId = nil
            manifest.uploadedBytes = 0
            manifest.nextChunkIndex = 0
        }
    }

    @objc func deleteUploadedRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let target = self.uploadTarget(call) else { return }
            var (manifest, url) = target
            do {
                // Verified server-side merge is authoritative; a crash may have lost the final
                // local byte acknowledgement after the server accepted the upload.
                guard manifest.sessionId == call.getString("sessionId") else {
                    throw self.uploadError("Audio upload is incomplete.")
                }
                // Persist the server-confirmed state first, so an interrupted deletion can resume on the next scan.
                manifest.uploaded = true
                try self.saveManifest(manifest, for: url)
                try self.removeUploadedFiles(for: url)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    private func removeUploadedFiles(for audioURL: URL) throws {
        let sidecar = manifestURL(for: audioURL)
        // Remove audio first; a remaining manifest is enough to retry cleanup after a crash.
        try removeIfPresent(audioURL)
        try removeIfPresent(sidecar)
    }

    private func removeIfPresent(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
            // The prior cleanup attempt already removed this file.
        }
    }

    private func uploadError(_ message: String) -> NSError {
        NSError(domain: "NativeAudio", code: 4, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func audioURL(for id: String, caregiverId: Int) throws -> URL {
        try recordingsDirectory(for: caregiverId).appendingPathComponent(id).appendingPathExtension("m4a")
    }

    private func manifestURL(for audioURL: URL) -> URL {
        audioURL.deletingPathExtension().appendingPathExtension("json")
    }

    private func loadManifest(for audioURL: URL) -> UploadManifest? {
        guard let data = try? Data(contentsOf: manifestURL(for: audioURL)) else { return nil }
        return try? JSONDecoder().decode(UploadManifest.self, from: data)
    }

    private func saveManifest(_ manifest: UploadManifest, for audioURL: URL) throws {
        let url = manifestURL(for: audioURL)
        try JSONEncoder().encode(manifest).write(to: url, options: .atomic)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
    }

    private func uploadTarget(_ call: CAPPluginCall) -> (UploadManifest, URL)? {
        guard let caregiverId = caregiverID(call), let id = recordingID(call) else {
            call.reject("A caregiver and recording are required.")
            return nil
        }
        do {
            let url = try audioURL(for: id, caregiverId: caregiverId)
            guard let manifest = loadManifest(for: url),
                  manifest.id == id, manifest.caregiverId == caregiverId else {
                call.reject("Saved recording not found.")
                return nil
            }
            return (manifest, url)
        } catch {
            call.reject("Unable to access saved recording.", nil, error)
            return nil
        }
    }

    private func updateManifest(_ call: CAPPluginCall, change: @escaping (inout UploadManifest, URL) throws -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let target = self.uploadTarget(call) else { return }
            var (manifest, url) = target
            do {
                try change(&manifest, url)
                try self.saveManifest(manifest, for: url)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    private func recordingsDirectory(for caregiverId: Int) throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = support.appendingPathComponent("Recordings", isDirectory: true)
            .appendingPathComponent(String(caregiverId), isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        return directory
    }

    private func metadata(for url: URL, durationHint: TimeInterval = 0) -> [String: Any]? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attributes[.size] as? NSNumber, size.intValue > 0,
              let audioPlayer = try? AVAudioPlayer(contentsOf: url) else { return nil }
        let duration = max(audioPlayer.duration, durationHint)
        guard duration > 0 else { return nil }
        let manifest = loadManifest(for: url)
        return [
            "id": url.deletingPathExtension().lastPathComponent,
            "durationSeconds": duration,
            "sizeBytes": size.intValue,
            "uploaded": manifest?.uploaded ?? false
        ]
    }

    private func latestRecording(for caregiverId: Int) -> [String: Any]? {
        guard let directory = try? recordingsDirectory(for: caregiverId),
              let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
              ) else { return nil }

        for file in files.sorted(by: {
            let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return left > right
        }) where file.pathExtension == "m4a" && file != recorder?.url {
            if let recording = metadata(for: file) { return recording }
        }
        return nil
    }

    @discardableResult
    private func finishRecording(interrupted: Bool) -> [String: Any]? {
        guard let activeRecorder = recorder else { return nil }
        let duration = activeRecorder.currentTime
        let caregiverId = recordingCaregiverId
        recorder = nil
        recordingCaregiverId = nil
        activeRecorder.delegate = nil
        activeRecorder.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        let recording = metadata(for: activeRecorder.url, durationHint: duration)
        if recording == nil {
            try? FileManager.default.removeItem(at: activeRecorder.url)
            try? FileManager.default.removeItem(at: manifestURL(for: activeRecorder.url))
        }
        interruptedCaregiverId = interrupted ? caregiverId : nil
        var event: [String: Any] = [
            "status": interrupted ? "interrupted" : (recording == nil ? "idle" : "saved"),
            "elapsedSeconds": duration
        ]
        if let recording { event["recording"] = recording }
        notifyListeners("recordingStateChanged", data: event)
        return recording
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType),
              type == .began else { return }
        DispatchQueue.main.async { [weak self] in
            self?.finishRecording(interrupted: true)
        }
    }

    public func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.recorder === recorder else { return }
            self.finishRecording(interrupted: !flag)
        }
    }

    public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.recorder === recorder else { return }
            self.finishRecording(interrupted: true)
        }
    }

}
