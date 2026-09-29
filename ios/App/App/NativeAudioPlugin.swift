import AVFAudio
import Capacitor
import Foundation

@objc(NativeAudioPlugin)
public class NativeAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate, AVAudioPlayerDelegate, @unchecked Sendable {
    public let identifier = "NativeAudioPlugin"
    public let jsName = "NativeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRecording", returnType: CAPPluginReturnPromise)
    ]

    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var recordingCaregiverId: Int?
    private var playbackCaregiverId: Int?
    private var interruptedCaregiverId: Int?

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
                        self.beginRecording(call, caregiverId: caregiverId, granted: granted)
                    }
                }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        self.beginRecording(call, caregiverId: caregiverId, granted: granted)
                    }
                }
            }
        }
    }

    private func beginRecording(_ call: CAPPluginCall, caregiverId: Int, granted: Bool) {
        guard granted else {
            call.reject("Microphone access is required. Enable it in iPhone Settings.")
            return
        }
        guard recorder == nil else {
            call.reject("A recording is already in progress.")
            return
        }

        var fileURL: URL?
        do {
            player?.stop()
            player = nil
            playbackCaregiverId = nil

            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .default)
            try audioSession.setActive(true)

            let directory = try recordingsDirectory(for: caregiverId)
            let url = directory.appendingPathComponent(UUID().uuidString.lowercased()).appendingPathExtension("m4a")
            fileURL = url
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
            if self.player != nil && self.playbackCaregiverId != caregiverId {
                self.player?.stop()
                self.player = nil
                self.playbackCaregiverId = nil
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let caregiverId = self.caregiverID(call) else {
                call.reject("A caregiver account is required.")
                return
            }
            guard self.recorder == nil else {
                call.reject("Stop recording before playback.")
                return
            }
            guard let id = call.getString("id"), let uuid = UUID(uuidString: id) else {
                call.reject("Invalid recording ID.")
                return
            }
            do {
                let url = try self.recordingsDirectory(for: caregiverId)
                    .appendingPathComponent(uuid.uuidString.lowercased())
                    .appendingPathExtension("m4a")
                let audioSession = AVAudioSession.sharedInstance()
                try audioSession.setCategory(.playback, mode: .default)
                try audioSession.setActive(true)
                let audioPlayer = try AVAudioPlayer(contentsOf: url)
                audioPlayer.delegate = self
                guard audioPlayer.play() else {
                    throw NSError(domain: "NativeAudio", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to play recording."])
                }
                self.player = audioPlayer
                self.playbackCaregiverId = caregiverId
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func stopPlayback(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.player?.stop()
            self?.player = nil
            self?.playbackCaregiverId = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.resolve()
        }
    }

    @objc func deleteRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let caregiverId = self.caregiverID(call) else {
                call.reject("A caregiver account is required.")
                return
            }
            guard self.recorder == nil else {
                call.reject("Stop recording before deleting audio.")
                return
            }
            guard let id = call.getString("id"), let uuid = UUID(uuidString: id) else {
                call.reject("Invalid recording ID.")
                return
            }
            do {
                let url = try self.recordingsDirectory(for: caregiverId)
                    .appendingPathComponent(uuid.uuidString.lowercased())
                    .appendingPathExtension("m4a")
                if self.player?.url == url {
                    self.player?.stop()
                    self.player = nil
                    self.playbackCaregiverId = nil
                    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                }
                try FileManager.default.removeItem(at: url)
                let latest = self.latestRecording(for: caregiverId)
                if self.interruptedCaregiverId == caregiverId { self.interruptedCaregiverId = nil }
                var result: [String: Any] = ["status": latest == nil ? "idle" : "saved"]
                if let latest { result["latestRecording"] = latest }
                call.resolve(result)
            } catch {
                call.reject("Unable to delete this recording.", nil, error)
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
        return [
            "id": url.deletingPathExtension().lastPathComponent,
            "durationSeconds": duration,
            "sizeBytes": size.intValue
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
        if recording == nil { try? FileManager.default.removeItem(at: activeRecorder.url) }
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

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.player = nil
            self?.playbackCaregiverId = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self?.notifyListeners("playbackFinished", data: [:])
        }
    }
}
