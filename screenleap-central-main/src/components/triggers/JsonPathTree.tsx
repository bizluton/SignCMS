import { useState } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";

interface NodeProps {
  value: any;
  path: string;
  name?: string;
  depth: number;
  copiedPath: string | null;
  onCopy: (path: string) => void;
  defaultOpen?: boolean;
}

const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
const isArr = (v: any) => Array.isArray(v);

const escapeKey = (k: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);

const joinPath = (base: string, key: string | number) => {
  if (typeof key === "number") return `${base}[${key}]`;
  const safe = escapeKey(key);
  if (safe.startsWith("\"")) return `${base}[${safe}]`;
  return base ? `${base}.${safe}` : safe;
};

function PrimitiveValue({ value }: { value: any }) {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  if (value === undefined) return <span className="italic text-muted-foreground">undefined</span>;
  if (typeof value === "string") return <span className="text-emerald-600 dark:text-emerald-400">"{value}"</span>;
  if (typeof value === "number") return <span className="text-amber-600 dark:text-amber-400">{value}</span>;
  if (typeof value === "boolean") return <span className="text-fuchsia-600 dark:text-fuchsia-400">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function Node({ value, path, name, depth, copiedPath, onCopy, defaultOpen }: NodeProps) {
  const container = isObj(value) || isArr(value);
  const [open, setOpen] = useState<boolean>(defaultOpen ?? depth < 2);
  const Icon = open ? ChevronDown : ChevronRight;
  const copied = copiedPath === path;

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div className="group flex items-start gap-1 hover:bg-accent/40 rounded px-1 -mx-1">
        {container ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <Icon className="w-3 h-3" />
          </button>
        ) : (
          <span className="shrink-0 w-3" />
        )}
        <div className="flex-1 min-w-0 break-all">
          {name !== undefined && (
            <>
              <span className="text-sky-600 dark:text-sky-400 font-medium">{name}</span>
              <span className="text-muted-foreground">: </span>
            </>
          )}
          {container ? (
            <span className="text-muted-foreground">
              {isArr(value) ? `Array(${value.length})` : `Object(${Object.keys(value).length})`}
              {!open && (isArr(value) ? " […]" : " {…}")}
            </span>
          ) : (
            <PrimitiveValue value={value} />
          )}
        </div>
        {path && (
          <button
            type="button"
            onClick={() => onCopy(path)}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1"
            title={`Copy path: ${path}`}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy path"}</span>
          </button>
        )}
      </div>
      {container && open && (
        <div className="ml-4 border-l border-border/60 pl-2">
          {isArr(value)
            ? (value as any[]).map((v, i) => (
                <Node
                  key={i}
                  value={v}
                  name={`[${i}]`}
                  path={joinPath(path, i)}
                  depth={depth + 1}
                  copiedPath={copiedPath}
                  onCopy={onCopy}
                />
              ))
            : Object.entries(value as Record<string, any>).map(([k, v]) => (
                <Node
                  key={k}
                  value={v}
                  name={k}
                  path={joinPath(path, k)}
                  depth={depth + 1}
                  copiedPath={copiedPath}
                  onCopy={onCopy}
                />
              ))}
        </div>
      )}
    </div>
  );
}

export function JsonPathTree({
  value,
  rootName = "$",
  copiedPath,
  onCopyPath,
}: {
  value: any;
  rootName?: string;
  copiedPath: string | null;
  onCopyPath: (path: string) => void;
}) {
  return (
    <div className="bg-muted/60 rounded-md p-3 max-h-[40vh] overflow-auto">
      <Node
        value={value}
        name={rootName}
        path={rootName}
        depth={0}
        copiedPath={copiedPath}
        onCopy={onCopyPath}
        defaultOpen
      />
    </div>
  );
}