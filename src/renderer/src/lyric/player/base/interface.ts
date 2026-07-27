import { Lyric } from '../../kit/lyric'

export interface BaseLyricPlayerEventMap {
  /**
   * When the player starts or resumes playback.
   * @param currentTime The current playback time.
   */
  play: (currentTime: number) => void

  /**
   * When the player pauses playback.
   * @param currentTime The current playback time.
   */
  pause: (currentTime: number) => void

  /**
   * When the entire lyric information is updated (e.g., loading a new lyric/song).
   * @param info The newly loaded lyric information object.
   */
  lyricUpdate: (info: Lyric.Parsed.Info) => void

  /**
   * When the currently active lyric lines change during playback.
   * @param lines An array of the currently active lyric lines.
   * @param indexs An array of the currently active lyric lines' indexes.
   * @param firstIndex The index of the first currently active lyric line (-1 if none).
   * @param isSeek Is seek.
   */
  linesUpdate: (
    lines: Lyric.Parsed.ParsedLine[],
    indexs: number[],
    index: number,
    isSeek: boolean
  ) => void
}
