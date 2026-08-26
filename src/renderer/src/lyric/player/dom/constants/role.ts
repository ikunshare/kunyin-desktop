export const PlayerRole = {
  root: 'root',
  container: 'container',
  // [vendor patch] 歌词末尾的附注区（制作人信息），跟随最后一行一起滚动
  footer: 'footer',
  line: {
    self: 'line',
    normal: {
      self: 'line-normal',
      text: {
        self: 'line-normal-text',
        word: {
          self: 'line-normal-text-word',
          char: 'line-normal-text-word-char',
          roman: 'line-normal-text-word-roman',
          ruby: 'line-normal-text-word-ruby'
        }
      },
      annotation: {
        self: 'line-normal-annotation',
        translation: 'line-normal-annotation-translation',
        romanization: 'line-normal-annotation-romanization'
      }
    },
    interlude: {
      self: 'line-interlude',
      dot: 'line-interlude-dot'
    }
  }
} as const
