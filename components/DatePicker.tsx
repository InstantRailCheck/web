"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  max?: string; // YYYY-MM-DD
  centerLabel?: boolean;
};

// A native <input type="date"> can't be reliably centered cross-browser —
// Chromium ignores text-align on its internal fields entirely (Firefox
// honors it), so the visible date sits flush left in Chrome/Edge no matter
// what CSS is applied. This Popover+Calendar picker sidesteps that by
// rendering the calendar ourselves instead of relying on native UI.

// Parses/formats using local calendar date components (not UTC) so a
// stored "YYYY-MM-DD" round-trips through the picker without shifting a
// day near midnight in any timezone.
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function DatePicker({ label, value, onChange, max, centerLabel = false }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const maxDate = max ? parseLocalDate(max) : undefined;

  return (
    <div className="flex flex-col items-center gap-1">
      <label className={cn("text-sm font-medium text-slate-300", centerLabel && "text-center")}>
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full flex-1 justify-center gap-2 rounded-xl border-slate-700 bg-slate-950 px-4 py-6 text-center font-medium text-white hover:bg-slate-900 hover:text-white"
          >
            {selected
              ? selected.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" })
              : "Select date"}
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-auto border-slate-800 bg-slate-950 p-0 text-white">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(formatLocalDate(date));
              setOpen(false);
            }}
            disabled={maxDate ? { after: maxDate } : undefined}
            classNames={{
              caption_label: "font-medium text-white select-none text-sm",
              weekday: "flex-1 text-[0.8rem] font-normal text-slate-500 select-none",
              button_previous: "text-white hover:bg-slate-800 hover:text-white",
              button_next: "text-white hover:bg-slate-800 hover:text-white",
              day: "group/day relative aspect-square h-full w-full rounded-lg p-0 text-center text-white select-none",
              today: "rounded-lg bg-slate-800 text-white",
              outside: "text-slate-600 aria-selected:text-slate-600",
              disabled: "text-slate-700 opacity-50",
            }}
            className="bg-slate-950 text-white"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
