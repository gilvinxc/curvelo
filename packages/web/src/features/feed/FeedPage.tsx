import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { PostDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
} from "../../components/ui";
import { Composer } from "./Composer";
import { ShoutoutDialog } from "./ShoutoutDialog";
import { PostCard } from "./PostCard";
import { PhotoShareComposer } from "./PhotoShare";

const PAGE_SIZE = 20;
const CAN_MODERATE = new Set(["COACH", "TEAM_ADMIN"]);

/** Team feed tab: composer + paginated post list. */
export function FeedPage({
  teamId,
  myRole,
}: {
  teamId: string;
  myRole: string | null;
}) {
  const { user } = useAuth();
  const [optimisticPosts, setOptimisticPosts] = useState<PostDTO[]>([]);
  const [shoutoutOpen, setShoutoutOpen] = useState(false);
  const canModerate = myRole !== null && CAN_MODERATE.has(myRole);
  // Alumni (outer tier) are read-only: no composer, no shoutouts.
  const isAlumni = myRole === "ALUMNI";
  // Parents are team members for photos, comments, and reactions — they get
  // a photo-only composer instead of the full one.
  const isParent = myRole === "PARENT";

  const feedQuery = useInfiniteQuery({
    queryKey: ["feed", teamId],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      api.listFeed(teamId, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.posts.length < PAGE_SIZE) return undefined;
      return lastPage.posts[lastPage.posts.length - 1].createdAt;
    },
  });

  const serverPosts = feedQuery.data?.pages.flatMap((p) => p.posts) ?? [];
  // Optimistic posts may duplicate server posts after refetch — dedupe by id.
  const seen = new Set(serverPosts.map((p) => p.id));
  const posts = [
    ...optimisticPosts.filter((p) => !seen.has(p.id)),
    ...serverPosts,
  ];

  return (
    <div className="flex flex-col gap-4">
      {!isAlumni && !isParent && (
        <>
          <Composer
            teamId={teamId}
            onPosted={(post) => setOptimisticPosts((prev) => [post, ...prev])}
          />
          <button
            type="button"
            onClick={() => setShoutoutOpen(true)}
            className="rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/5 px-4 py-3 text-left text-[14px] font-semibold text-amber-200 transition hover:border-amber-300/60 hover:bg-amber-300/10"
          >
            💛 Give a teammate a shoutout
          </button>
        </>
      )}
      {isParent && (
        <PhotoShareComposer
          teamId={teamId}
          onPosted={(post) => setOptimisticPosts((prev) => [post, ...prev])}
        />
      )}
      <ShoutoutDialog
        teamId={teamId}
        open={shoutoutOpen}
        onClose={() => setShoutoutOpen(false)}
        onPosted={(post) => setOptimisticPosts((prev) => [post, ...prev])}
      />

      {feedQuery.isLoading ? (
        <FullScreenLoader />
      ) : feedQuery.isError ? (
        <ErrorBanner message="Couldn't load the team feed." />
      ) : posts.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Be the first to share a run or drop a note for the team."
        />
      ) : (
        <>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              canModerate={canModerate}
              currentUserId={user?.id}
              onDeleted={() =>
                setOptimisticPosts((prev) => prev.filter((p) => p.id !== post.id))
              }
            />
          ))}
          {feedQuery.hasNextPage && (
            <Button
              variant="secondary"
              loading={feedQuery.isFetchingNextPage}
              onClick={() => feedQuery.fetchNextPage()}
              className="w-full"
            >
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
