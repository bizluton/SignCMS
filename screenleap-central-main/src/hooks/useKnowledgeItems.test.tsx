import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// vi.mock factories are hoisted; only references created via vi.hoisted()
// are guaranteed to exist when the factory runs.
const mocks = vi.hoisted(() => ({
  fromCalls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  authState: { user: null as { id: string } | null },
  orgState: { activeOrgId: null as string | null },
  userOrgsState: { defaultOrgId: null as string | null },
}));

function nextResponse(table: string): { data: unknown; error: unknown } {
  const queue = mocks.responses[table];
  if (!queue || queue.length === 0) return { data: [], error: null };
  return queue.shift()!;
}

type MockResponse = { data: unknown; error: unknown };
type MockChain = Record<string, (...args: unknown[]) => unknown>;

function makeQuery(table: string) {
  const chain: MockChain = {
    select(..._a: unknown[]) { mocks.fromCalls.push({ table, method: "select", args: _a }); return chain; },
    eq(..._a: unknown[]) { mocks.fromCalls.push({ table, method: "eq", args: _a }); return chain; },
    in(..._a: unknown[]) { mocks.fromCalls.push({ table, method: "in", args: _a }); return chain; },
    insert(rows: unknown) {
      mocks.fromCalls.push({ table, method: "insert", args: [rows] });
      const promise = Promise.resolve(nextResponse(table));
      const insertChain: MockChain = {
        select: () => insertChain,
        single: () => Promise.resolve(nextResponse(table)),
        then: (res: (v: MockResponse) => unknown, rej: (e: unknown) => unknown) => promise.then(res, rej),
      };
      return insertChain;
    },
    update(values: unknown) {
      mocks.fromCalls.push({ table, method: "update", args: [values] });
      const updateChain: MockChain = {
        eq: () => Promise.resolve(nextResponse(table)),
        in: () => Promise.resolve(nextResponse(table)),
      };
      return updateChain;
    },
    delete() {
      mocks.fromCalls.push({ table, method: "delete", args: [] });
      const deleteChain: MockChain = {
        eq: () => Promise.resolve(nextResponse(table)),
      };
      return deleteChain;
    },
    order() { return Promise.resolve(nextResponse(table)); },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocks.authState.user }),
}));

vi.mock("@/contexts/ActiveOrgContext", () => ({
  useActiveOrg: () => ({ activeOrgId: mocks.orgState.activeOrgId }),
}));

vi.mock("@/hooks/useUserOrgs", () => ({
  useUserOrgs: () => ({ defaultOrgId: mocks.userOrgsState.defaultOrgId }),
}));

const fromCalls = mocks.fromCalls;
const responses = mocks.responses;
const toastMock = mocks.toast;
const authState = mocks.authState;
const orgState = mocks.orgState;
const userOrgsState = mocks.userOrgsState;

import { useKnowledgeItems } from "./useKnowledgeItems";

describe("useKnowledgeItems", () => {
  beforeEach(() => {
    fromCalls.length = 0;
    Object.keys(responses).forEach((k) => delete responses[k]);
    Object.values(toastMock).forEach((fn) => fn.mockReset());
    authState.user = { id: "user-1" };
    orgState.activeOrgId = "org-1";
    userOrgsState.defaultOrgId = null;
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("loads items and maps the nested tag relation", async () => {
    responses.knowledge_items = [{
      data: [
        {
          id: "k1", title: "T1", description: "", category: "c", sub_category: "s",
          file_count: 0, synced: false, org_id: "org-1", created_by: "u",
          created_at: "", updated_at: "",
          knowledge_item_tags: [
            { tag_id: "t1", knowledge_tags: { id: "t1", name: "Promo", color: "red" } },
            { tag_id: "t2", knowledge_tags: null }, // dropped by .filter(Boolean)
          ],
        },
      ],
      error: null,
    }];

    const { result } = renderHook(() => useKnowledgeItems());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].tags).toEqual([{ id: "t1", name: "Promo", color: "red" }]);
  });

  it("does not query when there is no active or default org", async () => {
    orgState.activeOrgId = null;
    userOrgsState.defaultOrgId = null;

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toEqual([]);
    expect(fromCalls.find((c) => c.table === "knowledge_items")).toBeUndefined();
  });

  it("falls back to defaultOrgId when activeOrgId is null", async () => {
    orgState.activeOrgId = null;
    userOrgsState.defaultOrgId = "default-org";
    responses.knowledge_items = [{ data: [], error: null }];

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const eq = fromCalls.find((c) => c.table === "knowledge_items" && c.method === "eq");
    expect(eq?.args).toEqual(["org_id", "default-org"]);
  });

  it("addItem inserts the row, attaches tags, and refetches", async () => {
    // Initial load (empty) + insert response + refetch
    responses.knowledge_items = [
      { data: [], error: null },                        // initial fetch
      { data: { id: "new-1" }, error: null },           // insert ... .select().single()
      { data: [], error: null },                        // refetch after add
    ];
    responses.knowledge_item_tags = [
      { data: null, error: null },                      // tag bulk insert
    ];

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addItem({
        title: "Hello",
        description: "world",
        category: "cat",
        subCategory: "sub",
        tagIds: ["t1", "t2"],
      });
    });

    const insertItem = fromCalls.find((c) => c.table === "knowledge_items" && c.method === "insert");
    expect(insertItem).toBeDefined();
    const insertedRow = insertItem!.args[0] as Record<string, unknown>;
    expect(insertedRow.title).toBe("Hello");
    expect(insertedRow.org_id).toBe("org-1");
    expect(insertedRow.created_by).toBe("user-1");

    const insertTags = fromCalls.find((c) => c.table === "knowledge_item_tags" && c.method === "insert");
    expect(insertTags).toBeDefined();
    expect((insertTags!.args[0] as Array<{ tag_id: string }>).map((r) => r.tag_id)).toEqual(["t1", "t2"]);

    expect(toastMock.success).toHaveBeenCalledWith("知識點已新增");
  });

  it("addItem aborts with an error toast when no org is selected", async () => {
    // addItem captures the org id via useCallback deps, so we need the org to
    // be null BEFORE renderHook (otherwise the original orgId stays in closure).
    orgState.activeOrgId = null;
    userOrgsState.defaultOrgId = null;

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addItem({ title: "x", description: "", category: "", subCategory: "" });
    });

    expect(toastMock.error).toHaveBeenCalledWith("請先選擇組織");
    expect(fromCalls.find((c) => c.table === "knowledge_items" && c.method === "insert")).toBeUndefined();
  });

  it("deleteItem removes the row from local state on success", async () => {
    responses.knowledge_items = [
      {
        data: [
          { id: "k1", title: "A", description: "", category: "", sub_category: "",
            file_count: 0, synced: false, org_id: "org-1", created_by: "u",
            created_at: "", updated_at: "", knowledge_item_tags: [] },
          { id: "k2", title: "B", description: "", category: "", sub_category: "",
            file_count: 0, synced: false, org_id: "org-1", created_by: "u",
            created_at: "", updated_at: "", knowledge_item_tags: [] },
        ],
        error: null,
      },
      { data: null, error: null }, // delete().eq() response
    ];

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => { await result.current.deleteItem("k1"); });

    expect(result.current.items.map((i) => i.id)).toEqual(["k2"]);
    expect(toastMock.success).toHaveBeenCalledWith("知識點已刪除");
  });

  it("syncAll bails out with an info toast when nothing is unsynced", async () => {
    responses.knowledge_items = [{
      data: [{
        id: "k1", title: "A", description: "", category: "", sub_category: "",
        file_count: 0, synced: true, org_id: "org-1", created_by: "u",
        created_at: "", updated_at: "", knowledge_item_tags: [],
      }],
      error: null,
    }];

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => { await result.current.syncAll(); });

    expect(toastMock.info).toHaveBeenCalledWith("所有知識點已同步");
    expect(fromCalls.find((c) => c.table === "knowledge_items" && c.method === "update")).toBeUndefined();
  });

  it("syncAll updates unsynced rows and flips local state to synced", async () => {
    responses.knowledge_items = [
      {
        data: [
          { id: "k1", title: "", description: "", category: "", sub_category: "",
            file_count: 0, synced: false, org_id: "org-1", created_by: "u",
            created_at: "", updated_at: "", knowledge_item_tags: [] },
          { id: "k2", title: "", description: "", category: "", sub_category: "",
            file_count: 0, synced: true, org_id: "org-1", created_by: "u",
            created_at: "", updated_at: "", knowledge_item_tags: [] },
        ],
        error: null,
      },
      { data: null, error: null }, // update().in() response
    ];

    const { result } = renderHook(() => useKnowledgeItems());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => { await result.current.syncAll(); });

    expect(result.current.items.every((i) => i.synced)).toBe(true);
    expect(toastMock.success).toHaveBeenCalled();
  });
});
