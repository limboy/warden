import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Annotation, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  placeholder as placeholderExt,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export interface MarkdownEditorHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ref?: Ref<MarkdownEditorHandle>;
}

/** Marks transactions that sync in an external `value` so they aren't echoed back. */
const External = Annotation.define<boolean>();

// Colors come from CSS variables (see index.css) so themes can restyle them.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    color: "var(--color-foreground)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.7",
    padding: "32px 0",
  },
  ".cm-content": {
    maxWidth: "48rem",
    margin: "0 auto",
    padding: "0 32px",
    caretColor: "var(--color-foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--cm-selection)" },
  ".cm-selectionMatch": { backgroundColor: "var(--cm-match)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--cm-match)",
    outline: "1px solid var(--cm-match-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--cm-match-border)",
  },
  ".cm-placeholder": { color: "var(--color-muted-foreground)" },
  ".cm-panels": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--color-border)",
  },
  ".cm-panel.cm-search": {
    padding: "8px 12px",
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-textfield": {
    border: "1px solid var(--color-input)",
    borderRadius: "6px",
    padding: "3px 6px",
    backgroundColor: "transparent",
    color: "inherit",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--color-secondary)",
    color: "var(--color-secondary-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    padding: "3px 8px",
  },
  ".cm-panel.cm-search [name=close]": { color: "var(--color-muted-foreground)" },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.35em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.2em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--cm-link)" },
  { tag: t.monospace, color: "var(--cm-code)" },
  { tag: t.quote, color: "var(--color-muted-foreground)", fontStyle: "italic" },
  {
    tag: [t.processingInstruction, t.contentSeparator, t.meta, t.labelName],
    color: "var(--color-muted-foreground)",
  },
  // Fenced code blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--cm-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cm-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--cm-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--cm-function)" },
  { tag: [t.typeName, t.className], color: "var(--cm-type)" },
]);

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "",
  className,
  ref,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initial = useRef({ value, placeholder });
  // Last value we emitted or synced, to tell our own echoes from real changes.
  const lastValue = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          placeholderExt(initial.current.placeholder),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            spellcheck: "false",
            "aria-label": "Vault content",
          }),
          theme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(External))) {
              return;
            }
            const next = update.state.doc.toString();
            lastValue.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sync external replacements (e.g. restoring a backup). Kept in history so
  // they can be undone.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValue.current) return;
    lastValue.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: External.of(true),
    });
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
  }));

  return <div ref={hostRef} className={className} />;
}
