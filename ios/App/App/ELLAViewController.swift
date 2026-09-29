import Capacitor

class ELLAViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeAudioPlugin())
    }
}
