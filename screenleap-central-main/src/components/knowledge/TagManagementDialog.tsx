import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Tag as TagIcon, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useKnowledgeTags, KnowledgeTag } from "@/hooks/useKnowledgeTags";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#64748B",
];

const blank = { name: "", color: "#3B82F6" };

function SortableTagRow({
  tag,
  onEdit,
  onDelete,
}: {
  tag: KnowledgeTag;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 bg-background"
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
        aria-label="拖曳排序"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Badge style={{ backgroundColor: tag.color, color: "#fff" }} className="border-0">
        {tag.name}
      </Badge>
      <span className="flex-1 text-xs text-muted-foreground font-mono">{tag.color}</span>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function TagManagementDialog({ open, onOpenChange }: Props) {
  const { tags, loading, addTag, updateTag, deleteTag, reorderTags } = useKnowledgeTags();
  const [editing, setEditing] = useState<KnowledgeTag | null>(null);
  const [form, setForm] = useState(blank);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeTag | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tags.findIndex((t) => t.id === active.id);
    const newIndex = tags.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(tags, oldIndex, newIndex);
    await reorderTags(reordered.map((t) => t.id));
  };

  const startEdit = (t: KnowledgeTag) => {
    setEditing(t);
    setForm({ name: t.name, color: t.color });
  };

  const reset = () => {
    setEditing(null);
    setForm(blank);
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = editing
      ? await updateTag(editing.id, form)
      : await addTag(form);
    setSaving(false);
    if (ok) reset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              知識標籤管理
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-3 space-y-2">
              <div className="text-xs text-muted-foreground">共 {tags.length} 個標籤 · 拖曳左側手柄調整順序</div>
              <ScrollArea className="h-[320px] border border-border/50 rounded-md">
                <div className="p-2 space-y-1">
                  {loading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : tags.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">尚無標籤</div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={tags.map((t) => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {tags.map((tag) => (
                          <SortableTagRow
                            key={tag.id}
                            tag={tag}
                            onEdit={() => startEdit(tag)}
                            onDelete={() => setConfirmDelete(tag)}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="md:col-span-2 space-y-3 border border-border/50 rounded-md p-3">
              <div className="text-sm font-semibold">
                {editing ? "編輯標籤" : "新增標籤"}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">名稱 *</Label>
                <Input
                  value={form.name}
                  maxLength={30}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例如：重要"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">顏色</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, color: c }))}
                      className={`h-6 w-6 rounded-full border-2 ${
                        form.color === c ? "border-foreground" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
                <Input
                  value={form.color}
                  maxLength={7}
                  onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  placeholder="#3B82F6"
                  className="font-mono text-xs mt-1"
                />
              </div>
              <div className="pt-1">
                <div className="text-xs text-muted-foreground mb-1">預覽</div>
                <Badge style={{ backgroundColor: form.color, color: "#fff" }} className="border-0">
                  {form.name || "標籤名稱"}
                </Badge>
              </div>
              <div className="flex gap-2 pt-2">
                {editing && (
                  <Button variant="outline" size="sm" onClick={reset} className="flex-1">
                    取消
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 gap-1">
                  {!editing && <Plus className="h-3.5 w-3.5" />}
                  {editing ? "儲存" : "新增"}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除標籤「{confirmDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此標籤與知識點的關聯也會一併移除。此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDelete) await deleteTag(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
