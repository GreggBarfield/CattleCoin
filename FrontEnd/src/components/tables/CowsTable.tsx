import { useState } from "react";
import { ArrowUpDown, Trash2 } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/common/StageBadge";
import { VerifiedBadge } from "@/components/common/VerifiedBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDate, formatWeight } from "@/lib/utils";
import type { Cow, CowHealth, SexCode } from "@/lib/types";
import { SEX_LABELS } from "@/lib/types";

type CowSortKey =
  | "cowId"
  | "registrationNumber"
  | "stage"
  | "breedCode"
  | "sexCode"
  | "weightLbs"
  | "health"
  | "daysInStage"
  | "costToDateUsd"
  | "totalValue"
  | "createdAt";

const HEALTH_STYLES: Record<CowHealth, string> = {
  "On Track": "bg-green-100 text-green-800 border-green-200",
  Watch: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Issue: "bg-red-100 text-red-800 border-red-200",
};

const SEX_STYLES: Record<SexCode, string> = {
  S: "bg-blue-50 text-blue-700 border-blue-200",
  H: "bg-pink-50 text-pink-700 border-pink-200",
  B: "bg-orange-50 text-orange-700 border-orange-200",
  C: "bg-gray-50 text-gray-600 border-gray-200",
};

interface CowsTableProps {
  cows: Cow[];
  onRemove?: (cowId: string) => void;
}

export function CowsTable({ cows, onRemove }: CowsTableProps) {
  const [sortKey, setSortKey] = useState<CowSortKey>("cowId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: CowSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = [...cows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "cowId":
        return dir * a.cowId.localeCompare(b.cowId);
      case "registrationNumber":
        return dir * a.registrationNumber.localeCompare(b.registrationNumber);
      case "stage":
        return dir * a.stage.localeCompare(b.stage);
      case "breedCode":
        return dir * a.breedCode.localeCompare(b.breedCode);
      case "sexCode":
        return dir * a.sexCode.localeCompare(b.sexCode);
      case "weightLbs":
        return dir * (a.weightLbs - b.weightLbs);
      case "health":
        return dir * a.health.localeCompare(b.health);
      case "daysInStage":
        return dir * (a.daysInStage - b.daysInStage);
      case "costToDateUsd":
        return dir * (a.costToDateUsd - b.costToDateUsd);
      case "totalValue":
        return dir * (a.totalValue - b.totalValue);
      case "createdAt":
        return (
          dir *
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        );
      default:
        return 0;
    }
  });

  function SortHeader({
    label,
    field,
  }: {
    label: string;
    field: CowSortKey;
  }) {
    const isActive = sortKey === field;
    return (
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => handleSort(field)}
      >
        {label}
        <ArrowUpDown
          className={cn("h-3 w-3", isActive ? "opacity-100" : "opacity-40")}
        />
      </button>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortHeader label="Cattle ID" field="cowId" />
          </TableHead>
          <TableHead>
            <SortHeader label="Reg. #" field="registrationNumber" />
          </TableHead>
          <TableHead>
            <SortHeader label="Stage" field="stage" />
          </TableHead>
          <TableHead>
            <SortHeader label="Breed" field="breedCode" />
          </TableHead>
          <TableHead>
            <SortHeader label="Sex" field="sexCode" />
          </TableHead>
          <TableHead>
            <SortHeader label="Weight" field="weightLbs" />
          </TableHead>
          <TableHead>
            <SortHeader label="Health" field="health" />
          </TableHead>
          <TableHead>
            <SortHeader label="Days" field="daysInStage" />
          </TableHead>
          <TableHead>
            <SortHeader label="Enrolled" field="createdAt" />
          </TableHead>
          {onRemove && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((cow) => (
          <TableRow key={cow.cowId}>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-medium">{cow.cowId}</span>
                <VerifiedBadge verified={cow.verified} />
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {cow.registrationNumber}
            </TableCell>
            <TableCell>
              <StageBadge stage={cow.stage} />
            </TableCell>
            <TableCell className="text-sm">{cow.breedCode}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn("text-xs", SEX_STYLES[cow.sexCode])}
              >
                {SEX_LABELS[cow.sexCode]}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">{formatWeight(cow.weightLbs)}</TableCell>
            <TableCell>
              <Badge variant="outline" className={HEALTH_STYLES[cow.health]}>
                {cow.health}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">{cow.daysInStage}d</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDate(cow.createdAt)}
            </TableCell>
            {onRemove && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(cow.cowId)}
                  title="Remove from lot"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CowsTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
