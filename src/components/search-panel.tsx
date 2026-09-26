// Mounted imperatively by CodeMirror, so fast refresh doesn't apply here.
/* eslint-disable react-refresh/only-export-components */
import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { EditorState } from "@codemirror/state";
import { runScopeHandlers, type EditorView, type Panel } from "@codemirror/view";
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import {
  CaseSensitive,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Regex,
  Replace,
  ReplaceAll,
  TextSelect,
  WholeWord,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Stop counting past this many matches so huge documents stay responsive. */
const MAX_COUNT = 1000;

/** Drop-in `createPanel` for `search()` with a two-row find / replace layout. */
export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search";
  const listeners = new Set<() => void>();
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => view.state,
  };
  const root = createRoot(dom);
  // Render synchronously so the `main-field` input exists when the search
  // package looks it up to focus it.
  flushSync(() => root.render(<SearchPanel view={view} store={store} />));

  return {
    dom,
    top: true,
    mount() {
      const input = dom.querySelector<HTMLInputElement>("[main-field]");
      input?.focus();
      input?.select();
    },
    update() {
      listeners.forEach((l) => l());
    },
    destroy() {
      // Defer so we don't unmount React while it may be rendering.
      queueMicrotask(() => root.unmount());
    },
  };
}

interface Store {
  subscribe: (listener: () => void) => () => void;
  get: () => EditorState;
}

function countMatches(state: EditorState, query: SearchQuery) {
  if (!query.valid) return { total: 0, current: 0, capped: false };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total >= MAX_COUNT) return { total, current, capped: true };
  }
  return { total, current, capped: false };
}

function SearchPanel({ view, store }: { view: EditorView; store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const query = getSearchQuery(state);
  const [showReplace, setShowReplace] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);
  const canReplace = !state.readOnly;
  const replacing = canReplace && showReplace;

  const commit = (patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const next = new SearchQuery({
      search: query.search,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
      replace: query.replace,
      ...patch,
    });
    if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) });
  };

  const { total, current, capped } = countMatches(state, query);
  const hasMatches = total > 0;
  const invalid = query.search !== "" && !query.valid;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) {
      e.preventDefault();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      if (e.target.name === "replace") {
        (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(view);
      } else {
        (e.shiftKey ? findPrevious : findNext)(view);
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <Field invalid={invalid}>
          <input
            name="search"
            main-field="true"
            value={query.search}
            onChange={(e) => commit({ search: e.target.value })}
            placeholder="Find…"
            aria-label="Find"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          <IconButton
            label="Match case"
            active={query.caseSensitive}
            onClick={() => commit({ caseSensitive: !query.caseSensitive })}
          >
            <CaseSensitive />
          </IconButton>
          <IconButton
            label="Match whole word"
            active={query.wholeWord}
            onClick={() => commit({ wholeWord: !query.wholeWord })}
          >
            <WholeWord />
          </IconButton>
          <IconButton
            label="Use regular expression"
            active={query.regexp}
            onClick={() => commit({ regexp: !query.regexp })}
          >
            <Regex />
          </IconButton>
        </Field>
        <div className="flex w-44 shrink-0 items-center gap-1">
          {canReplace && (
            <IconButton
              label="Toggle replace"
              active={replacing}
              onClick={() => {
                flushSync(() => setShowReplace((v) => !v));
                if (!replacing) replaceRef.current?.focus();
              }}
            >
              <Replace />
            </IconButton>
          )}
          <IconButton
            label="Select all matches"
            disabled={!hasMatches}
            onClick={() => selectMatches(view)}
          >
            <TextSelect />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            label="Previous match"
            disabled={!hasMatches}
            onClick={() => findPrevious(view)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Next match"
            disabled={!hasMatches}
            onClick={() => findNext(view)}
          >
            <ChevronRight />
          </IconButton>
          <span className="ml-1 whitespace-nowrap tabular-nums text-muted-foreground">
            {query.search === ""
              ? ""
              : `${current || "?"}/${total}${capped ? "+" : ""}`}
          </span>
        </div>
      </div>
      {replacing && (
        <div className="flex items-center gap-2">
          <Field>
            <input
              ref={replaceRef}
              name="replace"
              value={query.replace}
              onChange={(e) => commit({ replace: e.target.value })}
              placeholder="Replace with…"
              aria-label="Replace"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </Field>
          <div className="flex w-44 shrink-0 items-center gap-1">
            <IconButton
              label="Replace next match"
              disabled={!hasMatches}
              onClick={() => replaceNext(view)}
            >
              <CornerDownLeft />
            </IconButton>
            <IconButton
              label="Replace all matches"
              disabled={!hasMatches}
              onClick={() => replaceAll(view)}
            >
              <ReplaceAll />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ invalid, children }: { invalid?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-input pr-1 pl-2 focus-within:border-ring",
        invalid && "border-destructive focus-within:border-destructive",
      )}
    >
      {children}
    </div>
  );
}

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    // The wrapper carries the hover so the tooltip also shows on disabled buttons.
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        // Keep focus in the input when clicking toggles.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
          active && "bg-accent text-[color:var(--cm-link)]",
        )}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 -translate-x-1/2 rounded-md bg-primary px-2 py-1 text-xs whitespace-nowrap text-primary-foreground opacity-0 transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-300"
      >
        {label}
      </span>
    </span>
  );
}
