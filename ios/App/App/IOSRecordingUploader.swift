import Foundation
import UIKit

extension Notification.Name {
    static let ellaRecordingUploadCompleted = Notification.Name("ellaRecordingUploadCompleted")
}

// Owns iOS recording transfers independently of the WebView lifecycle.
final class IOSRecordingUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = IOSRecordingUploader()

    private let sessionIdentifier = "com.ella.parentportal.recording-upload"
    private let apiKey = "ELLARecordingAPIBase"
    private let defaultAPI = "https://hri-autism-backend.onrender.com/api"
    private var session: URLSession!
    private var loadedTasks = false
    private var activeCaregivers = Set<Int>()
    private var pausedRecordings = Set<String>()
    private var blockedRecordings = Set<String>()
    private var inFlight = Set<String>()
    private var retryCounts = [String: Int]()
    private var retryAfter = [String: Date]()
    private var responseBodies = [Int: Data]()
    private var backgroundCompletion: (() -> Void)?

    private override init() { super.init() }

    private struct Transfer {
        let kind: String
        let caregiverId: Int
        let recordingId: String
        let index: Int

        var key: String { "\(kind)|\(caregiverId)|\(recordingId)|\(index)" }

        init?(description: String?) {
            guard let parts = description?.split(separator: "|", omittingEmptySubsequences: false), parts.count == 4,
                  let caregiverId = Int(parts[1]), caregiverId > 0,
                  let index = Int(parts[3]), UUID(uuidString: String(parts[2])) != nil else { return nil }
            kind = String(parts[0]); self.caregiverId = caregiverId
            recordingId = String(parts[2]); self.index = index
        }

        init(_ kind: String, _ caregiverId: Int, _ recordingId: String, _ index: Int = -1) {
            self.kind = kind; self.caregiverId = caregiverId
            self.recordingId = recordingId; self.index = index
        }
    }

    func start() {
        onMain {
            guard self.session == nil else { return }
            let configuration = URLSessionConfiguration.background(withIdentifier: self.sessionIdentifier)
            configuration.isDiscretionary = false
            configuration.waitsForConnectivity = true
            configuration.httpMaximumConnectionsPerHost = 4
            self.session = URLSession(configuration: configuration, delegate: self,
                                      delegateQueue: OperationQueue.main)
            self.session.getAllTasks { tasks in
                self.onMain {
                    for task in tasks {
                        if let transfer = Transfer(description: task.taskDescription) {
                            self.inFlight.insert(transfer.key)
                            self.activeCaregivers.insert(transfer.caregiverId)
                        }
                    }
                    self.loadedTasks = true
                    self.activeCaregivers.forEach { self.schedule(caregiverId: $0) }
                }
            }
        }
    }

    func handleBackgroundEvents(identifier: String, completion: @escaping () -> Void) {
        onMain {
            guard identifier == self.sessionIdentifier else { completion(); return }
            self.start()
            self.backgroundCompletion = completion
        }
    }

    func configure(baseURL: String) -> Bool {
        guard let url = URL(string: baseURL), url.scheme == "https", url.host != nil,
              url.path.hasSuffix("/api"), url.user == nil, url.password == nil else { return false }
        UserDefaults.standard.set(baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: apiKey)
        start()
        return true
    }

    func kick(caregiverId: Int) {
        onMain {
            self.start()
            self.activeCaregivers.insert(caregiverId)
            self.schedule(caregiverId: caregiverId)
        }
    }

    func pause(caregiverId: Int, recordingId: String) {
        onMain {
            let key = "\(caregiverId)|\(recordingId)"
            self.pausedRecordings.insert(key)
            self.session?.getAllTasks { tasks in
                for task in tasks {
                    guard let transfer = Transfer(description: task.taskDescription),
                          transfer.caregiverId == caregiverId, transfer.recordingId == recordingId else { continue }
                    task.cancel()
                }
            }
        }
    }

    func resume(caregiverId: Int, recordingId: String) {
        onMain {
            self.pausedRecordings.remove("\(caregiverId)|\(recordingId)")
            self.blockedRecordings.remove("\(caregiverId)|\(recordingId)")
            self.schedule(caregiverId: caregiverId)
        }
    }

    private func onMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }

    private func baseURL() -> String {
        UserDefaults.standard.string(forKey: apiKey) ?? defaultAPI
    }

    private func request(_ path: String, method: String = "GET") -> URLRequest? {
        guard let url = URL(string: baseURL() + path) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 120
        return request
    }

    private func manifests(_ caregiverId: Int) -> [(URL, RecordingManifest)] {
        recordingFileLock.lock(); defer { recordingFileLock.unlock() }
        guard let root = try? RecordingStore.root(caregiverId),
              let directories = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        return directories.compactMap { directory in
            guard let manifest = try? RecordingStore.load(directory), manifest.caregiverId == caregiverId,
                  !manifest.uploaded else { return nil }
            return (directory, manifest)
        }
    }

    private func schedule(caregiverId: Int) {
        guard loadedTasks else { return }
        for (directory, manifest) in manifests(caregiverId) {
            let recordingKey = "\(caregiverId)|\(manifest.id)"
            if pausedRecordings.contains(recordingKey) || blockedRecordings.contains(recordingKey) { continue }
            if manifest.uploadCompleted == true || manifest.segmentCount == 0 ||
               manifest.nextChunkIndex > manifest.segmentCount { continue }
            if manifest.sessionId == nil {
                enqueueCreate(manifest, directory)
                continue
            }
            let acknowledged = Set(manifest.confirmedChunkIndexes ?? [])
            var outstanding = inFlight.filter { $0.hasPrefix("chunk|\(recordingKey)|") }.count
            for index in manifest.nextChunkIndex..<manifest.segmentCount where outstanding < 4 {
                if acknowledged.contains(index) { continue }
                let transfer = Transfer("chunk", caregiverId, manifest.id, index)
                if inFlight.contains(transfer.key) { continue }
                enqueueChunk(transfer, sessionId: manifest.sessionId!, directory: directory)
                outstanding += 1
            }
            if manifest.stopped && manifest.nextChunkIndex == manifest.segmentCount && outstanding == 0 {
                enqueueComplete(manifest, directory)
            }
        }
    }

    private func enqueueCreate(_ manifest: RecordingManifest, _ directory: URL) {
        let transfer = Transfer("create", manifest.caregiverId, manifest.id)
        guard !inFlight.contains(transfer.key),
              var request = request("/recordings/sessions", method: "POST") else { return }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["date": manifest.date, "caregiverId": manifest.caregiverId,
                    "childId": 1, "chunkFormat": "standalone"] as [String: Any]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let file = writeRequestFile(data, directory, "create.json") else {
            block(transfer, "Unable to prepare the recording session.")
            return
        }
        enqueue(transfer, request, file)
    }

    private func enqueueChunk(_ transfer: Transfer, sessionId: String, directory: URL) {
        let encoded = "audio/wav".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "audio%2Fwav"
        guard var request = request("/recordings/sessions/\(sessionId)/chunks?chunkIndex=\(transfer.index)&mimeType=\(encoded)",
                                    method: "POST") else { return }
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        let file = RecordingStore.segment(directory, transfer.index)
        guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0 else {
            block(transfer, "Saved audio chunk is unavailable.")
            return
        }
        enqueue(transfer, request, file)
    }

    private func enqueueComplete(_ manifest: RecordingManifest, _ directory: URL) {
        guard let sessionId = manifest.sessionId,
              var request = request("/recordings/sessions/\(sessionId)/complete", method: "POST") else { return }
        let transfer = Transfer("complete", manifest.caregiverId, manifest.id)
        guard !inFlight.contains(transfer.key) else { return }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["finalChunkIndex": manifest.segmentCount - 1,
                    "durationSeconds": max(1, Int(ceil(manifest.durationSeconds)))]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let file = writeRequestFile(data, directory, "complete.json") else {
            block(transfer, "Unable to prepare recording completion.")
            return
        }
        enqueue(transfer, request, file)
    }

    private func writeRequestFile(_ data: Data, _ directory: URL, _ name: String) -> URL? {
        let url = directory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                  ofItemAtPath: url.path)
            return url
        } catch { return nil }
    }

    private func enqueue(_ transfer: Transfer, _ request: URLRequest, _ file: URL) {
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = transfer.key
        task.earliestBeginDate = retryAfter[transfer.key]
        inFlight.insert(transfer.key)
        task.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseBodies[dataTask.taskIdentifier, default: Data()].append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let transfer = Transfer(description: task.taskDescription) else { return }
        let data = responseBodies.removeValue(forKey: task.taskIdentifier) ?? Data()
        inFlight.remove(transfer.key)
        let recordingKey = "\(transfer.caregiverId)|\(transfer.recordingId)"
        if pausedRecordings.contains(recordingKey) { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if error == nil && (200..<300).contains(status) {
            retryCounts.removeValue(forKey: transfer.key)
            retryAfter.removeValue(forKey: transfer.key)
            guard applySuccess(transfer, json) else {
                block(transfer, "Recording upload response could not be verified.")
                return
            }
            if transfer.kind == "complete" { finishCompletedUpload(transfer) }
            schedule(caregiverId: transfer.caregiverId)
        } else if status == 409 && (transfer.kind == "complete" || transfer.kind == "chunk") {
            reconcileCompletion(transfer, detail: json["detail"] as? String)
        } else if status == 0 || status >= 500 || (error as NSError?)?.code == NSURLErrorCancelled {
            // A queued file upload can continue even if the WebView is suspended.
            let attempts = min(8, (retryCounts[transfer.key] ?? 0) + 1)
            retryCounts[transfer.key] = attempts
            retryAfter[transfer.key] = Date().addingTimeInterval(min(300, Double(1 << attempts)))
            schedule(caregiverId: transfer.caregiverId)
        } else {
            let detail = json["detail"] as? String ?? "Recording upload failed (HTTP \(status))."
            block(transfer, detail)
        }
    }

    private func block(_ transfer: Transfer, _ message: String) {
        blockedRecordings.insert("\(transfer.caregiverId)|\(transfer.recordingId)")
        recordingFileLock.lock(); defer { recordingFileLock.unlock() }
        guard let directory = try? RecordingStore.directory(transfer.caregiverId, transfer.recordingId),
              var manifest = try? RecordingStore.load(directory) else { return }
        manifest.uploadError = message
        try? RecordingStore.save(manifest, directory)
    }

    private func applySuccess(_ transfer: Transfer, _ json: [String: Any]) -> Bool {
        recordingFileLock.lock(); defer { recordingFileLock.unlock() }
        guard let directory = try? RecordingStore.directory(transfer.caregiverId, transfer.recordingId),
              var manifest = try? RecordingStore.load(directory) else { return false }
        switch transfer.kind {
        case "create":
            guard let sessionId = json["sessionId"] as? String, !sessionId.isEmpty,
                  json["caregiverId"] as? Int == manifest.caregiverId,
                  json["date"] as? String == manifest.date,
                  json["chunkFormat"] as? String == "standalone",
                  json["status"] as? String == "recording", manifest.sessionId == nil else { return false }
            manifest.sessionId = sessionId
        case "chunk":
            guard json["sessionId"] as? String == manifest.sessionId,
                  json["chunkIndex"] as? Int == transfer.index else { return false }
            var acknowledged = Set(manifest.confirmedChunkIndexes ?? [])
            acknowledged.insert(transfer.index)
            while acknowledged.remove(manifest.nextChunkIndex) != nil { manifest.nextChunkIndex += 1 }
            manifest.confirmedChunkIndexes = acknowledged.sorted()
        case "complete":
            guard json["sessionId"] as? String == manifest.sessionId,
                  json["status"] as? String == "completed",
                  json["uploadedChunks"] as? Int == manifest.segmentCount,
                  json["lastChunkIndex"] as? Int == manifest.segmentCount - 1 else { return false }
            manifest.uploadCompleted = true
        default: return false
        }
        manifest.uploadError = nil
        do { try RecordingStore.save(manifest, directory); return true }
        catch { return false }
    }

    private func finishCompletedUpload(_ transfer: Transfer) {
        recordingFileLock.lock()
        guard let directory = try? RecordingStore.directory(transfer.caregiverId, transfer.recordingId),
              var manifest = try? RecordingStore.load(directory),
              manifest.sessionId != nil, manifest.uploadCompleted == true,
              manifest.stopped, !manifest.uploaded else {
            recordingFileLock.unlock()
            return
        }
        manifest.uploaded = true
        try? RecordingStore.save(manifest, directory)
        recordingFileLock.unlock()
        NotificationCenter.default.post(name: .ellaRecordingUploadCompleted, object: manifest)
        DispatchQueue.global(qos: .utility).async {
            recordingFileLock.lock(); defer { recordingFileLock.unlock() }
            // getPendingUploads retries if this removal fails or the app exits first.
            try? FileManager.default.removeItem(at: directory)
        }
    }

    private func reconcileCompletion(_ transfer: Transfer, detail: String?) {
        guard let directory = try? RecordingStore.directory(transfer.caregiverId, transfer.recordingId),
              let manifest = try? RecordingStore.load(directory), let sessionId = manifest.sessionId,
              let request = request("/recordings/sessions/\(sessionId)") else { return }
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let data,
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
            self.onMain {
                guard json["sessionId"] as? String == sessionId,
                      json["caregiverId"] as? Int == manifest.caregiverId,
                      json["date"] as? String == manifest.date,
                      json["chunkFormat"] as? String == "standalone" else {
                    self.block(transfer, "Recording session does not match this audio.")
                    return
                }
                if json["status"] as? String == "completed" {
                    guard manifest.stopped, json["lastChunkIndex"] as? Int == manifest.segmentCount - 1,
                          json["uploadedChunks"] as? Int == manifest.segmentCount else {
                        self.block(transfer, "Completed session does not match this audio.")
                        return
                    }
                    let completion = Transfer("complete", transfer.caregiverId, transfer.recordingId)
                    if self.applySuccess(completion, json) {
                        self.finishCompletedUpload(completion)
                        self.schedule(caregiverId: transfer.caregiverId)
                    }
                } else if transfer.kind == "chunk" {
                    self.block(transfer, detail ?? "Recording chunk was rejected by the server.")
                } else if json["status"] as? String != "recording" {
                    self.block(transfer, "Recording session is no longer active.")
                }
            }
        }.resume()
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        guard let completion = backgroundCompletion else { return }
        backgroundCompletion = nil
        completion()
    }
}
