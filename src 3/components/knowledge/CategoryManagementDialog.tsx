import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, FolderOpen, GripVertical } from "lucide-react";
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
import { useKnowledgeCategories, KnowledgeCategory } from "@/hooks/useKnowledgeCategories";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const blank = { name: "", description: "", icon: "Folder", sort_order: 0, parent_key: "store" as "hq" | "store" };

function SortableCategoryRow({
  category,
  onEdit,
  onDelete,
}: {
  category: KnowledgeCategory;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
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
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group bg-background"
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
      <span className="text-xs text-muted-foreground w-8 shrink-0">#{category.sort_order}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{category.name}</div>
        {category.description && (
          <div className="text-xs text-muted-foreground truncate">{category.description}</div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function CategoryManagementDialog({ open, onOpenChange }: Props) {
  const { categories, loading, addCategory, updateCategory, deleteCategory, reorderCategories } = useKnowledgeCategories();
  const [editing, setEditing] = useState<KnowledgeCategory | null>(null);
  const [form, setForm] = useState(blank);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeCategory | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (group: "hq" | "store", event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const groupItems = categories.filter((c) => (c.parent_key ?? "store") === group);
    const oldIndex = groupItems.findIndex((c) => c.id === active.id);
    const newIndex = groupItems.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(groupItems, oldIndex, newIndex);
    await reorderCategories(reordered.map((c) => c.id));
  };

  const startEdit = (c: KnowledgeCategory) => {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description,
      icon: c.icon,
      sort_order: c.sort_order,
      parent_key: c.parent_key ?? "store",
    });
  };

  const reset = () => {
    setEditing(null);
    setForm(blank);
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = editing
      ? await updateCategory(editing.id, form)
      : await addCategory(form);
    setSaving(false);
    if (ok) reset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              知識分類管理
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* List */}
            <div className="md:col-span-3 space-y-2">
              <div className="text-xs text-muted-foreground">共 {categories.length} 個分類</div>
              <ScrollArea className="h-[360px] border border-border/50 rounded-md">
                <div className="p-2 divide-y divide-border/60">
                  {loading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : categories.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">尚無分類</div>
                  ) : (
                    (["hq", "store"] as const).map((group, idx) => {
                      const groupItems = categories.filter((c) => (c.parent_key ?? "store") === group);
                      const groupLabel = group === "hq" ? "系統軟體" : "硬體產品";
                      return (
                        <div key={group} className={cn("space-y-1", idx === 0 ? "pb-3" : "pt-3")}>
                          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-2 py-1.5 flex items-center gap-2 rounded-sm">
                            <Badge variant={group === "hq" ? "default" : "secondary"} className="text-[10px]">
                              {groupLabel}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{groupItems.length} 項</span>
                          </div>
                          {groupItems.length === 0 ? (
                            <div className="text-xs text-muted-foreground py-2 px-2">此主分類下尚無細分類</div>
                          ) : (
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={(e) => handleDragEnd(group, e)}
                            >
                              <SortableContext
                                items={groupItems.map((c) => c.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                {groupItems.map((c) => (
                                  <SortableCategoryRow
                                    key={c.id}
                                    category={c}
                                    onEdit={() => startEdit(c)}
                                    onDelete={() => setConfirmDelete(c)}
                                  />
                                ))}
                              </SortableContext>
                            </DndContext>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Form */}
            <div className="md:col-span-2 space-y-3 border border-border/50 rounded-md p-3">
              <div className="text-sm font-semibold">
                {editing ? "編輯分類" : "新增分類"}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">名稱 *</Label>
                <Input
                  value={form.name}
                  maxLength={50}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例如：產品介紹"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">所屬主分類 *</Label>
                <Select
                  value={form.parent_key}
                  onValueChange={(v) => setForm((p) => ({ ...p, parent_key: v as "hq" | "store" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hq">系統軟體</SelectItem>
                    <SelectItem value="store">硬體產品</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">描述</Label>
                <Textarea
                  value={form.description}
                  maxLength={200}
                  rows={2}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="簡短說明"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">圖示</Label>
                  <Input
                    value={form.icon}
                    maxLength={40}
                    onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                    placeholder="Folder"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">排序</Label>
                  <Input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.sort_order}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, sort_order: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
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
            <AlertDialogTitle>刪除分類「{confirmDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              已使用此分類的知識點分類欄位將被清空，但知識點本身不會被刪除。此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmDelete) await deleteCategory(confirmDelete.id);
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
