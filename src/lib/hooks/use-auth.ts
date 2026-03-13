"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function useAuth() {
  const supabase = createClient();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ["auth-user"],
    staleTime: 5 * 60 * 1000, // 5 min — auth state rarely changes mid-session
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    staleTime: 5 * 60 * 1000, // 5 min
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("id, email, full_name, display_name, avatar_url, stripe_customer_id, referral_code, referred_by, timezone").eq("id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  const signOut = useMutation({
    mutationFn: async () => {
      await supabase.auth.signOut();
    },
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
    },
  });

  return { user, profile, isLoading, signOut: signOut.mutate };
}
