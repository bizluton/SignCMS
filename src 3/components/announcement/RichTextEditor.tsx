import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import FontFamily from "@tiptap/extension-font-family";
import FontSize from "@tiptap/extension-font-size";
import { useRef } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, ImagePlus, Palette, Undo2, Redo2, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}

const FONT_FAMILIES = [
  { value: "default", label: "預設字型" },
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Microsoft JhengHei", label: "微軟正黑體" },
  { value: "Noto Sans TC", label: "Noto Sans TC" },
];

const FONT_SIZES = [
  { value: "12px", label: "12" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "20px", label: "20" },
  { value: "24px", label: "24" },
  { value: "28px", label: "28" },
  { value: "32px", label: "32" },
  { value: "36px", label: "36" },
  { value: "48px", label: "48" },
];

const PRESET_COLORS = [
  "#000000", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
  "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb",
  "#7c3aed", "#db2777", "#374151",
];

const RichTextEditor = ({ content, onChange, placeholder, minHeight = "160px" }: RichTextEditorProps) => {
  const { t } = useLanguage();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-4 py-3",
          "min-h-[var(--editor-min-h)]"
        ),
        style: `--editor-min-h: ${minHeight}`,
      },
    },
  });

  if (!editor) return null;

  const handleImageUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      editor.chain().focus().setImage({ src: url }).run();
    };
    reader.readAsDataURL(file);
  };

  const ToolbarButton = ({
    onClick,
    active,
    children,
    title,
  }: {
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
    title?: string;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      className={cn(
        "h-8 w-8 p-0 rounded-md",
        active && "bg-accent text-accent-foreground"
      )}
    >
      {children}
    </Button>
  );

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
        {/* Undo / Redo */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title={t("tipUndo")}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title={t("tipRedo")}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Font Family */}
        <Select
          value={editor.getAttributes("textStyle").fontFamily || "default"}
          onValueChange={(val) => {
            if (val === "default") {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(val).run();
            }
          }}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs border-0 bg-transparent">
            <Type className="h-3.5 w-3.5 mr-1 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs" style={{ fontFamily: f.value === "default" ? undefined : f.value }}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Font Size */}
        <Select
          value={editor.getAttributes("textStyle").fontSize || "16px"}
          onValueChange={(val) => editor.chain().focus().setFontSize(val).run()}
        >
          <SelectTrigger className="h-8 w-[70px] text-xs border-0 bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Bold / Italic / Underline / Strikethrough */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title={t("tipBold")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title={t("tipItalic")}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title={t("tipUnderline")}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title={t("tipStrikethrough")}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Text Color */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-md" title={t("tipTextColor")}>
              <div className="flex flex-col items-center">
                <Palette className="h-3.5 w-3.5" />
                <div
                  className="h-1 w-4 rounded-full mt-0.5"
                  style={{ backgroundColor: editor.getAttributes("textStyle").color || "currentColor" }}
                />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <div className="grid grid-cols-6 gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "h-7 w-7 rounded-md border border-border hover:scale-110 transition-transform",
                    editor.getAttributes("textStyle").color === color && "ring-2 ring-primary ring-offset-1"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => editor.chain().focus().setColor(color).run()}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
              <Input
                type="color"
                className="h-8 w-10 p-0.5 cursor-pointer"
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => editor.chain().focus().unsetColor().run()}
              >
                重置
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Alignment */}
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title={t("tipAlignLeft")}>
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title={t("tipAlignCenter")}>
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title={t("tipAlignRight")}>
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title={t("tipBulletList")}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title={t("tipOrderedList")}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Insert Image */}
        <ToolbarButton onClick={() => imageInputRef.current?.click()} title={t("tipInsertImage")}>
          <ImagePlus className="h-4 w-4" />
        </ToolbarButton>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
