declare module "soundfont-player" {
  export interface PlayOptions {
    duration?: number;
    gain?: number;
    velocity?: number;
  }

  export interface SoundfontInstrument {
    play(
      note: number | string,
      when?: number,
      options?: PlayOptions,
    ): AudioNode & { stop?: (when?: number) => void };
  }

  export interface InstrumentOptions {
    soundfont?: "MusyngKite" | "FluidR3_GM";
    format?: "mp3" | "ogg";
    nameToUrl?: (
      name: string,
      soundfont: string,
      format: string,
    ) => string;
  }

  export function instrument(
    ac: AudioContext,
    name: string,
    options?: InstrumentOptions,
  ): Promise<SoundfontInstrument>;

  const Soundfont: {
    instrument: typeof instrument;
  };

  export default Soundfont;
}
