import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";
import { InstalledRoundsPage } from "../features/rounds/library/InstalledRoundsPage";

const RoundsSearchSchema = z.object({
  open: z.enum(["install-rounds", "install-web"]).optional(),
  groupMode: z.enum(["hero", "playlist"]).optional(),
  sortMode: z
    .enum(["newest", "oldest", "difficulty", "bpm", "length", "name", "excluded"])
    .optional(),
  query: z.string().optional(),
  showDisabled: z.boolean().optional(),
});

export const Route = createFileRoute("/rounds")({
  validateSearch: (search) => RoundsSearchSchema.parse(search),
  component: RoundsRouteComponent,
});

function RoundsRouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <InstalledRoundsPage
      search={{
        open: search.open,
        groupMode: search.groupMode,
        sortMode: search.sortMode,
        query: search.query,
        showDisabled: search.showDisabled,
      }}
      navigate={(opts) =>
        navigate({
          to: opts.to as never,
          search: opts.search as never,
          replace: opts.replace,
        })
      }
    />
  );
}
