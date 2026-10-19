import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { organiserApi } from "@/lib/organiser-api";
import { saveOrganiserToken, useOrganiserToken } from "@/lib/organiser-session";
import { organiserQueries } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * Who's signed in to the organisers' dashboard, and how to change that. Switching
 * account drops everything cached for the last one, so one organiser's orders are
 * never shown to another — not even for a moment while the new ones load.
 */
export function useOrganiserSession() {
  const token = useOrganiserToken();
  const queryClient = useQueryClient();
  const router = useRouter();
  const forgetEverything = () => {
    queryClient.removeQueries({ queryKey: organiserQueries.all() });
  };

  const account = useQuery({ ...organiserQueries.account(), enabled: Boolean(token) });

  const signIn = useMutation({
    mutationFn: organiserApi.signIn,
    onSuccess: ({ token: newToken }) => {
      forgetEverything();
      saveOrganiserToken(newToken);
      router.replace(routes.organiser());
    },
  });

  const signOut = async () => {
    await organiserApi.signOut();
    forgetEverything();
    saveOrganiserToken(null);
    router.replace(routes.organiserSignIn());
  };

  return { token, account: account.data, signIn, signOut };
}
