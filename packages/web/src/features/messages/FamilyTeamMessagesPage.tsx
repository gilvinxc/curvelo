import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";
import {
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { MessagesSection } from "./MessagesSection";

/** Guardian read-only view of one team's conversations for a linked athlete. */
export function FamilyTeamMessagesPage() {
  const { athleteId, teamId } = useParams<{
    athleteId: string;
    teamId: string;
  }>();

  const childrenQuery = useQuery({
    queryKey: ["children"],
    queryFn: () => api.myChildren(),
  });

  if (childrenQuery.isLoading) return <FullScreenLoader />;

  const child = childrenQuery.data?.children.find(
    (c) => c.athleteId === athleteId && c.teamId === teamId,
  );

  return (
    <div>
      <PageHeader
        title={child ? `${child.athleteName.split(" ")[0]}'s team messages` : "Team messages"}
        subtitle={child?.teamName ?? "Read-only view"}
        backTo="/family"
      />
      {childrenQuery.isError || !child ? (
        <ErrorBanner message="Couldn't load this team's conversations." />
      ) : (
        <MessagesSection teamId={child.teamId} readOnly />
      )}
    </div>
  );
}
