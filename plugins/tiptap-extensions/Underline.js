import { Mark } from 'tiptap'
import { toggleMark, markInputRule, markPasteRule } from 'tiptap-commands'

export default class Underline extends Mark {
  get name() {
    return 'underline'
  }

  get schema() {
    return {
      parseDOM: [
        {
          tag: 'u',
        },
        {
          style: 'text-decoration',
          getAttrs: value => value === 'underline',
        },
      ],
      toDOM: () => ['u', 0],
    }
  }

  keys({ type }) {
    return {
      'Mod-u': toggleMark(type),
    }
  }

  commands({ type }) {
    return () => toggleMark(type)
  }

  inputRules({ type }) {
    return [markInputRule(/(?:^|[^_])(__([^_]+)__)$/, type)]
  }

  pasteRules({ type }) {
    return [markPasteRule(/__([^_]+)__/g, type)]
  }
}
