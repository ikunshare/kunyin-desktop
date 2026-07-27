/**
 * replace matched text to target
 *
 * @param text original text
 * @param target target text
 * @param rules replace rule
 * @param flag regexp flag
 */
export const replaceTextWithRule = (
  text: string,
  target: string,
  rules: (string | RegExp)[],
  flag: string = 'giu'
) => {
  let result = text
  for (const rule of rules) {
    try {
      // [vendor patch] 改用 instanceof：lodash 的 isRegExp 类型签名是 (v: any) => boolean，
      // 不是类型守卫，故 rule 未被缩窄、三元结果推断成 string | RegExp，取 .global 报错。
      const regex = rule instanceof RegExp ? rule : new RegExp(rule, flag)
      result = regex.global ? result.replaceAll(regex, target) : result.replace(regex, target)
    } catch {
      continue
    }
  }
  return result
}
