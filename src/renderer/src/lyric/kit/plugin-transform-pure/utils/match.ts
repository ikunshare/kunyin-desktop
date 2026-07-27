export type MatchRule = string | RegExp

export interface MatchRuleGroup {
  fuzzy: MatchRule[]
  exact: MatchRule[]
}

export interface MatchOptions {
  /**
   * Select the matching strategy.
   * @default fuzzy
   */
  mode: 'fuzzy' | 'exact'
  /**
   * Configure fuzzy matching.
   */
  fuzzy: {}
  /**
   * Configure exact matching.
   */
  exact: {
    /**
     * Require at least this percentage of the line to match.
     * @default 50
     */
    check: number
  }
  /**
   * Configure the active rules.
   */
  rule: {
    /**
     * Include the default rules for the selected mode.
     * @default true
     */
    useDefault: boolean
    /**
     * Append custom rules to the selected default rule group.
     * @default []
     */
    custom: MatchRule[]
  }
}

export abstract class Matcher {
  private options: MatchOptions
  private defaultRules: MatchRuleGroup

  /**
   * Create a matcher from its options and mode-specific default rules.
   */
  protected constructor(options: MatchOptions, defaultRules: MatchRuleGroup) {
    this.options = options
    this.defaultRules = defaultRules
  }

  /**
   * Create the matcher selected by the configured mode.
   */
  static create(options: MatchOptions, defaultRules: MatchRuleGroup): Matcher {
    const matcher =
      options.mode === 'fuzzy'
        ? new FuzzyMatcher(options, defaultRules)
        : new ExactMatcher(options, defaultRules)
    matcher.rebuild()
    return matcher
  }

  /**
   * Replace the options and rebuild or replace the matcher when needed.
   */
  update(options: MatchOptions): Matcher {
    if (options.mode !== this.mode) {
      return Matcher.create(options, this.defaultRules)
    }

    this.options = options
    this.rebuild()
    return this
  }

  /**
   * Match one normalized line against the active rules.
   */
  match(line: string, extra?: string[]): boolean {
    if (!line) {
      return false
    }

    const target = line.trim().toLowerCase()
    if (!target.length) {
      return false
    }

    return this.matchTarget(target, extra)
  }

  protected abstract get mode(): MatchOptions['mode']

  /**
   * Build the mode-specific matcher state.
   */
  protected abstract build(rules: MatchRule[], options: MatchOptions): void

  /**
   * Match a normalized line using the mode-specific algorithm.
   */
  protected abstract matchTarget(line: string, extra?: string[]): boolean

  /**
   * Rebuild the mode-specific matcher state.
   */
  private rebuild(): void {
    this.build(this.resolveRules(this.options), this.options)
  }

  /**
   * Resolve the active default and custom rules.
   */
  private resolveRules(options: MatchOptions): MatchRule[] {
    const defaults = this.defaultRules[options.mode]
    const custom = options.rule.custom ?? []
    return options.rule.useDefault ? [...defaults, ...custom] : [...custom]
  }
}

export class FuzzyMatcher extends Matcher {
  private combinedRegex: RegExp | null = null
  private regexRules: RegExp[] = []

  protected override get mode(): MatchOptions['mode'] {
    return 'fuzzy'
  }

  /**
   * Build a fuzzy matcher from the active rules.
   */
  protected override build(rules: MatchRule[]): void {
    const stringRules: string[] = []
    this.combinedRegex = null
    this.regexRules = []

    for (const rule of rules) {
      if (typeof rule === 'string') {
        stringRules.push(rule.toLowerCase())
      } else {
        this.regexRules.push(rule)
      }
    }

    if (stringRules.length > 0) {
      const target = stringRules
        .sort((a, b) => b.length - a.length)
        .map((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      this.combinedRegex = new RegExp(`(${target.join('|')})`, 'i')
    }
  }

  /**
   * Match when any configured rule is present.
   */
  protected override matchTarget(line: string, extra?: string[]): boolean {
    if (this.combinedRegex?.test(line)) {
      return true
    }

    for (const rule of this.regexRules) {
      rule.lastIndex = 0
      if (rule.test(line)) {
        return true
      }
    }

    for (const rule of extra ?? []) {
      if (line.includes(rule.toLowerCase())) {
        return true
      }
    }

    return false
  }
}

export class ExactMatcher extends Matcher {
  private stringRules: string[] = []
  private regexRules: RegExp[] = []
  private threshold = 0

  protected override get mode(): MatchOptions['mode'] {
    return 'exact'
  }

  /**
   * Build an exact matcher from the active rules and threshold.
   */
  protected override build(rules: MatchRule[], options: MatchOptions): void {
    this.stringRules = []
    this.regexRules = []
    this.threshold = options.exact.check

    for (const rule of rules) {
      if (typeof rule === 'string') {
        this.stringRules.push(rule.toLowerCase())
      } else {
        this.regexRules.push(rule)
      }
    }
  }

  /**
   * Match when rule coverage reaches the configured threshold.
   */
  protected override matchTarget(line: string, extra?: string[]): boolean {
    const thresholdPercent = Math.min(Math.max(this.threshold, 0), 100)
    const targetMatchCount = Math.ceil((thresholdPercent / 100) * line.length)
    if (targetMatchCount === 0) {
      return true
    }

    const matchedChars = new Uint8Array(line.length)
    let matchedCount = 0

    for (const rule of [...this.stringRules, ...(extra ?? [])]) {
      const normalized = rule.toLowerCase()
      const ruleLength = normalized.length
      if (ruleLength === 0) {
        continue
      }

      let position = line.indexOf(normalized)
      while (position !== -1) {
        matchedCount += this.markMatchedRange(matchedChars, position, ruleLength)
        if (matchedCount >= targetMatchCount) {
          return true
        }
        position = line.indexOf(normalized, position + ruleLength)
      }
    }

    for (const rule of this.regexRules) {
      const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`
      const matcher = new RegExp(rule.source, flags)

      let result = matcher.exec(line)
      while (result) {
        if (result[0]) {
          matchedCount += this.markMatchedRange(matchedChars, result.index, result[0].length)
          if (matchedCount >= targetMatchCount) {
            return true
          }
        } else {
          matcher.lastIndex++
        }

        result = matcher.exec(line)
      }
    }

    return false
  }

  /**
   * Mark one matched range and return the number of newly covered characters.
   */
  private markMatchedRange(matchedChars: Uint8Array, start: number, length: number): number {
    let count = 0
    const end = Math.min(start + length, matchedChars.length)

    for (let index = start; index < end; index++) {
      if (matchedChars[index] === 0) {
        matchedChars[index] = 1
        count++
      }
    }

    return count
  }
}
