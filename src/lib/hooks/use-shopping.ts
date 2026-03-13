"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type {
  ShoppingList,
  ShoppingItem,
  ShoppingItemCategory,
} from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Auto-categorization map
// ---------------------------------------------------------------------------
const CATEGORY_KEYWORDS: Record<ShoppingItemCategory, string[]> = {
  produce: [
    "apple", "banana", "orange", "lettuce", "tomato", "onion", "potato",
    "carrot", "broccoli", "spinach", "avocado", "pepper", "cucumber",
    "celery", "garlic", "lemon", "lime", "grape", "strawberry", "blueberry",
    "mushroom", "corn", "pea", "bean", "kale", "fruit", "vegetable", "salad",
  ],
  dairy: [
    "milk", "cheese", "yogurt", "butter", "cream", "egg", "sour cream",
    "cottage cheese", "whipped cream", "half and half", "creamer",
  ],
  meat: [
    "chicken", "beef", "pork", "turkey", "salmon", "fish", "shrimp",
    "steak", "bacon", "sausage", "ham", "ground", "lamb", "tuna",
  ],
  bakery: [
    "bread", "bagel", "muffin", "roll", "bun", "croissant", "tortilla",
    "pita", "cake", "pie", "donut", "pastry",
  ],
  frozen: [
    "frozen", "ice cream", "pizza", "waffles", "popsicle",
  ],
  pantry: [
    "rice", "pasta", "flour", "sugar", "oil", "vinegar", "sauce", "soup",
    "can", "cereal", "oatmeal", "peanut butter", "jelly", "honey",
    "spice", "salt", "pepper", "ketchup", "mustard", "mayo", "dressing",
  ],
  beverages: [
    "water", "juice", "soda", "coffee", "tea", "beer", "wine", "drink",
    "sparkling", "lemonade", "smoothie", "kombucha",
  ],
  snacks: [
    "chips", "crackers", "cookies", "candy", "popcorn", "nuts", "granola",
    "bar", "pretzels", "trail mix", "gummy", "chocolate",
  ],
  cleaning: [
    "detergent", "bleach", "cleaner", "wipes", "sponge", "dish soap",
    "trash bag", "garbage bag", "mop", "broom", "lysol", "disinfectant",
  ],
  household: [
    "paper towel", "toilet paper", "napkin", "foil", "wrap", "ziplock",
    "battery", "light bulb", "candle", "tissue",
  ],
  personal: [
    "shampoo", "conditioner", "soap", "toothpaste", "toothbrush",
    "deodorant", "lotion", "razor", "sunscreen", "floss", "bandaid",
  ],
  pets: [
    "dog food", "cat food", "pet", "kibble", "litter", "treat",
  ],
  other: [],
};

export function detectCategory(name: string): ShoppingItemCategory {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === "other") continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat as ShoppingItemCategory;
    }
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Shopping Lists hook
// ---------------------------------------------------------------------------
export function useShopping() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Fetch all lists ----
  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: ["shopping-lists", householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("id, household_id, name, icon, sort_order, is_archived, recurring_items, created_by, created_at")
        .eq("household_id", householdId)
        .eq("is_archived", false)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as ShoppingList[];
    },
    enabled: !!householdId,
  });

  // ---- Create a new list ----
  const createList = useMutation({
    mutationFn: async (params: {
      name: string;
      icon?: string;
      createdBy: string;
    }) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("shopping_lists")
        .insert({
          household_id: householdId,
          name: params.name,
          icon: params.icon || "shopping-cart",
          sort_order: lists.length,
          is_archived: false,
          recurring_items: [],
          created_by: params.createdBy,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ShoppingList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-lists"] });
      toast.success("List created");
    },
    onError: (error) => {
      toast.error("Failed to create list: " + error.message);
    },
  });

  // ---- Archive a list ----
  const archiveList = useMutation({
    mutationFn: async (listId: string) => {
      const { error } = await supabase
        .from("shopping_lists")
        .update({ is_archived: true })
        .eq("id", listId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-lists"] });
      toast.success("List archived");
    },
    onError: (error) => {
      toast.error("Failed to archive list: " + error.message);
    },
  });

  return { lists, listsLoading, createList, archiveList };
}

// ---------------------------------------------------------------------------
// Shopping Items hook (per list)
// ---------------------------------------------------------------------------
export function useShoppingItems(listId: string | null) {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["shopping-items", listId],
    queryFn: async () => {
      if (!listId || !householdId) return [];
      const { data, error } = await supabase
        .from("shopping_items")
        .select("id, list_id, household_id, name, quantity, category, note, is_checked, checked_by, checked_at, assigned_to, added_by, created_at")
        .eq("list_id", listId)
        .eq("household_id", householdId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ShoppingItem[];
    },
    enabled: !!listId && !!householdId,
  });

  // ---- Add item ----
  const addItem = useMutation({
    mutationFn: async (params: {
      name: string;
      quantity?: string;
      category?: ShoppingItemCategory;
      note?: string;
      assignedTo?: string;
      addedBy: string;
    }) => {
      if (!listId || !householdId) throw new Error("No list selected");
      const category = params.category || detectCategory(params.name);
      const { data, error } = await supabase
        .from("shopping_items")
        .insert({
          list_id: listId,
          household_id: householdId,
          name: params.name,
          quantity: params.quantity || null,
          category,
          note: params.note || null,
          is_checked: false,
          checked_by: null,
          checked_at: null,
          assigned_to: params.assignedTo || null,
          added_by: params.addedBy,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ShoppingItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-items", listId] });
    },
    onError: (error) => {
      toast.error("Failed to add item: " + error.message);
    },
  });

  // ---- Toggle checked ----
  const toggleItem = useMutation({
    mutationFn: async (params: { itemId: string; checked: boolean; memberId: string }) => {
      const { error } = await supabase
        .from("shopping_items")
        .update({
          is_checked: params.checked,
          checked_by: params.checked ? params.memberId : null,
          checked_at: params.checked ? new Date().toISOString() : null,
        })
        .eq("id", params.itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-items", listId] });
    },
    onError: (error) => {
      toast.error("Failed to update item: " + error.message);
    },
  });

  // ---- Delete item ----
  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("shopping_items")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-items", listId] });
    },
    onError: (error) => {
      toast.error("Failed to delete item: " + error.message);
    },
  });

  // ---- Clear checked items ----
  const clearChecked = useMutation({
    mutationFn: async () => {
      if (!listId) throw new Error("No list selected");
      const { error } = await supabase
        .from("shopping_items")
        .delete()
        .eq("list_id", listId)
        .eq("is_checked", true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-items", listId] });
      toast.success("Checked items cleared");
    },
    onError: (error) => {
      toast.error("Failed to clear items: " + error.message);
    },
  });

  return { items, itemsLoading, addItem, toggleItem, deleteItem, clearChecked };
}
