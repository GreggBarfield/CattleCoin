import { Card, CardContent } from "@/components/ui/card";
import type { Division } from "@/lib/marketplace";

// Plain-English descriptions of what an investor is buying into. Both kinds of
// lot pay the same way at the end (your own money first, then your share of the
// gain); what differs is who is raising the money and what the herd's first
// cost is. Wording is meant to be reviewed before real investors see it.

const COW_CALF = {
  title: "Cow-Calf lots: backing the rancher who raised the calves",
  points: [
    "The rancher owns the herd and raised the calves.",
    "The herd's agreed starting value counts as its first cost, so you only share in the gain above that value.",
    "The herd is sold to a feedyard or a packer. You get your money back first, then your token share of the profit after costs.",
  ],
};

const FEEDER = {
  title: "Feeder lots: backing a feedyard that bought the cattle",
  points: [
    "A feedyard bought these cattle and is feeding them out.",
    "What the feedyard paid counts as the herd's first cost. Feed, yardage and vet bills are added as they happen, and you can see them on the lot page.",
    "When the finished cattle are sold, you get your money back first, then your token share of the profit after all costs.",
  ],
};

function Panel({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="flex-1 min-w-[16rem]">
      <p className="font-semibold text-sm">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-600 list-disc pl-5">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export function DivisionExplainer({ division }: { division: Division | "all" }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex flex-wrap gap-6">
          {(division === "all" || division === "cow-calf") && <Panel {...COW_CALF} />}
          {(division === "all" || division === "feeder") && <Panel {...FEEDER} />}
        </div>
        <p className="text-xs text-slate-500 border-t pt-3">
          If a herd sells for less than it cost, the loss is shared by token share and you can get back less than you
          paid. Cattle prices go up and down. Nothing on this page is a promise of profit.
        </p>
      </CardContent>
    </Card>
  );
}

export function RetainedComingSoon() {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-5">
        <p className="font-semibold text-sm">
          Coming soon: Retained ownership{" "}
          <span className="ml-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            not open yet
          </span>
        </p>
        <p className="mt-2 text-sm text-slate-600">
          The rancher keeps ownership the whole way while a feedyard finishes the cattle for a fee. It is one herd and
          one payout at the end, based on how the carcasses grade. There are no lots to buy in this track yet.
        </p>
      </CardContent>
    </Card>
  );
}
