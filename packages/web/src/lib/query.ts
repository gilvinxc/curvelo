import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Don't retry auth failures — they just mean "logged out".
        if (error instanceof Error && "status" in error && (error as { status: number }).status === 401) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});
