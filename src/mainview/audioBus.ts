// Shared Web Audio bus. The VideoPlayer connects its <video> element once;
// every SpectrumControl canvas samples the same AnalyserNode. Because the
// media is served CORS-enabled via the `media://` protocol, the analyser can
// read real frequency data.
class AudioBus {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  analyser: AnalyserNode | null = null;

  /** Attach a video element to the bus. Safe to call repeatedly. */
  connect(video: HTMLVideoElement): void {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      // Requires a CORS-clean media source (crossOrigin="anonymous" on the
      // <video> + ACAO header on the media response), otherwise the source is
      // tainted and the analyser throws. Guard so it never crashes the app.
      if (!this.source) this.source = this.ctx.createMediaElementSource(video);
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.source.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      void this.ctx.resume();
    } catch {
      // CORS / taint error: spectrum falls back to an idle baseline.
      this.source = null;
      this.analyser = null;
    }
  }

  /** Creates a reusable, time-stable frequency array for a canvas. */
  makeFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser) return null;
    return new Uint8Array(this.analyser.frequencyBinCount);
  }

  getFrequency(data: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    try {
      this.analyser.getByteFrequencyData(data);
      return true;
    } catch {
      return false;
    }
  }

  setFftSize(n: number): void {
    if (this.analyser) this.analyser.fftSize = n;
  }

  /** Resume the AudioContext within a user gesture (the play-click), so the
   *  autoplay policy allows the source→graph route — otherwise the <video>
   *  will not advance while audio is routed through the analyser. */
  resume(): void {
    void this.ctx?.resume();
  }
}

export const audioBus = new AudioBus();
