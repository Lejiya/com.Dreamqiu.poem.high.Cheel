// 抽测题目的切分与抽取逻辑（纯函数，方便在 node 里单测）
// 设计要点：
//  1) 诗文里「一联」之间用空行（\n\n）分隔，联内用 ，；：。？！ 等标点分句；
//  2) 顿号「、」不算分句（"子路、曾皙、冉有" 是一个整体，"便胜却、人间无数" 也是）；
//  3) 冒号后面紧跟引号（对话）时不切，避免把 "子曰：“……”" 切坏；
//  4) 题目 = 同一联内相邻的两个分句，生成「给上句填下句」「给下句填上句」两个方向。

import { getPoem, getBook } from "./poem-data"

/** 分句的终止标点（顿号不在内） */
const BREAK_CHARS = "，。；！？,;!?"
/** 冒号单独处理：后面不是引号才当分句边界 */
const COLON = "：:"
/** 跟在终止标点后面、应粘在同一分句里的收尾符号 */
const TAIL_CHARS = "”’」』）)》〉…"

/** 答案/提示里"真正的字"（去掉标点）个数的上下限 */
const CJK_MIN = 3
const CJK_MAX = 40

/** 标点与符号（统计"字"数时排除） */
const PUNCT = "，。；：！？、,;:!?…—“”‘’「」『』《》〈〉（）()【】[]·－-～~ \u3000"

/** 统计有效字数（排除标点空白） */
export function cjkLen(s) {
  const str = String(s || "")
  let n = 0
  for (let i = 0; i < str.length; i++) {
    if (PUNCT.indexOf(str[i]) < 0) n++
  }
  return n
}

function isBreak(ch) {
  return BREAK_CHARS.indexOf(ch) >= 0 || COLON.indexOf(ch) >= 0
}

function isOpeningQuote(ch) {
  return ch === "“" || ch === "「" || ch === "『" || ch === '"'
}

/**
 * 去掉分句首尾的曲牌/词牌标记（如「【皂罗袍】」）与多余空白。
 * @param {string} t
 */
function cleanClause(t) {
  let s = String(t || "").trim()
  // 句首可能连续出现多个标记
  for (let k = 0; k < 4; k++) {
    const m = /^【[^】]{0,12}】/.exec(s)
    if (!m) break
    s = s.slice(m[0].length).trim()
  }
  return s
}

/**
 * 把一行（一联）切成若干分句，标点保留在分句末尾。
 * @param {string} line
 * @returns {string[]}
 */
export function splitLine(line) {
  const s = String(line || "")
  const out = []
  let cur = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (isBreak(ch)) {
      // 冒号后面紧跟引号（对话）时不断句
      if (COLON.indexOf(ch) >= 0 && isOpeningQuote(s[i + 1])) {
        cur += ch
        continue
      }
      cur += ch
      // 把紧跟的收尾符号（引号、括号等）一起吃进来
      while (i + 1 < s.length && TAIL_CHARS.indexOf(s[i + 1]) >= 0) {
        i++
        cur += s[i]
      }
      const t = cleanClause(cur)
      if (t) out.push(t)
      cur = ""
      continue
    }
    cur += ch
  }
  const t = cleanClause(cur)
  if (t) out.push(t)
  return out
}

/**
 * 把整篇正文按「联」切开，每个联再切成若干分句。
 * @param {string} text
 * @returns {string[][]}
 */
export function splitLines(text) {
  const raw = String(text || "").replace(/\r/g, "")
  const lines = raw.split("\n")
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    const clauses = splitLine(t)
    if (clauses.length) out.push(clauses)
  }
  return out
}

function acceptable(s) {
  const n = cjkLen(s)
  return n >= CJK_MIN && n <= CJK_MAX
}

/**
 * 生成一篇诗文的全部候选题。
 * 每题形如 { cue, ans, line, index, dir, key }
 *  - cue: 显示的提示句；ans: 要填的句子
 *  - line: 属于第几联（从 0 开始）
 *  - index: 该题在整篇题库里的序号
 *  - dir: "next" 表示要填下一句，"prev" 表示要填上一句
 *  - key: 去重/避重用的标识
 * @param {string} text
 * @returns {Array<{cue:string,ans:string,line:number,index:number,dir:string,key:string}>}
 */
export function buildQuestions(text) {
  const lines = splitLines(text)
  const out = []
  const seen = {}
  for (let li = 0; li < lines.length; li++) {
    const cs = lines[li]
    for (let i = 0; i + 1 < cs.length; i++) {
      const a = cs[i]
      const b = cs[i + 1]
      if (!acceptable(a) || !acceptable(b)) continue
      // 方向一：给上句 a，填下句 b
      push(a, b, li, "next")
      // 方向二：给下句 b，填上句 a
      push(b, a, li, "prev")
    }
  }
  function push(cue, ans, line, dir) {
    const key = cue + "\u0001" + ans
    if (seen[key]) return
    seen[key] = 1
    out.push({ cue: cue, ans: ans, line: line, index: out.length, dir: dir, key: key })
  }
  return out
}

/** 只要数量时用它（不建数组，省内存） */
export function countQuestions(text) {
  return buildQuestions(text).length
}

/** 稳定可用的随机数（0 <= x < 1），退化时也能工作 */
function rand() {
  const r = Math.random()
  return r >= 0 && r < 1 ? r : 0.5
}

function pickOne(arr) {
  if (!arr || !arr.length) return null
  return arr[Math.floor(rand() * arr.length)]
}

/**
 * 从已启用篇目里抽一道题。
 * 先等概率抽篇目（这样每篇被练到的机会一样），再在该篇里等概率抽题。
 * @param {string[]} titles 已启用篇目
 * @param {string[]} [avoidKeys] 最近抽过的题目 key，尽量避开
 * @returns {{title:string,book:string,people:string,cue:string,ans:string,key:string}|null}
 */
export function pickQuestion(titles, avoidKeys) {
  const list = (titles || []).filter((t) => !!t)
  if (!list.length) return null
  const avoid = {}
  const av = avoidKeys || []
  for (let i = 0; i < av.length; i++) avoid[av[i]] = 1

  // 最多试 6 次挑一个没抽过的题；实在避不开就用最后一次的结果
  let fallback = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const title = pickOne(list)
    const poem = title ? getPoem(title) : null
    if (!poem) continue
    const qs = buildQuestions(poem.text)
    if (!qs.length) continue
    const q = pickOne(qs)
    if (!q) continue
    const item = {
      title: title,
      book: getBook(title) || "",
      people: poem.people || "",
      cue: q.cue,
      ans: q.ans,
      dir: q.dir,
      key: q.key,
    }
    if (!avoid[q.key]) return item
    fallback = item
  }
  return fallback
}
