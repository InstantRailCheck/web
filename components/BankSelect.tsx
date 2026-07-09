"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Bank = {
  id: string;
  name: string;
};

type BankSelectProps = {
  label: string;
  placeholder: string;
  banks: Bank[];
  value?: string;
  onChange?: (bankId: string) => void;
  onAdd?: (name: string) => Promise<string>;
  centerLabel?: boolean;
};

// Rendering all banks (4,000+) as raw DOM nodes at once — even with cmdk
// hiding non-matches via CSS rather than removing them — makes cmdk's own
// internal keyboard-highlight tracking (a DOM querySelectorAll over live
// nodes) unreliable at that scale. Pre-filtering to a small, bounded list
// before it ever reaches cmdk avoids that entirely.
const RESULTS_LIMIT = 50;

export function BankSelect({
  label,
  placeholder,
  banks,
  value = "",
  onChange,
  onAdd,
  centerLabel = false,
}: BankSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const selectedBank = banks.find((bank) => bank.id === value);

  const filteredBanks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query
      ? banks.filter((bank) => bank.name.toLowerCase().includes(query))
      : banks;
    return matches.slice(0, RESULTS_LIMIT);
  }, [banks, search]);

  function handleSelect(bankId: string) {
    onChange?.(bankId === value ? "" : bankId);
    setOpen(false);
    setSearch("");
  }

  async function handleAdd() {
    if (!onAdd || !search.trim()) return;
    setAdding(true);
    try {
      const newId = await onAdd(search.trim());
      onChange?.(newId);
      setOpen(false);
      setSearch("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="block">
      <span className={cn("mb-2 block text-sm font-medium text-slate-300", centerLabel && "text-center")}>
        {label}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between rounded-xl border-slate-700 bg-slate-950 px-4 py-6 text-left text-white hover:bg-slate-900 hover:text-white"
          >
            {selectedBank ? selectedBank.name : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] border-slate-800 bg-slate-950 p-0 text-white">
          <Command className="bg-slate-950 text-white" shouldFilter={false}>
            <CommandInput placeholder="Search banks..." onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>
                {onAdd && search.trim() ? (
                  <button
                    onClick={handleAdd}
                    disabled={adding}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
                  >
                    {adding ? "Adding..." : `+ Add "${search.trim()}"`}
                  </button>
                ) : (
                  "No bank found."
                )}
              </CommandEmpty>
              <CommandGroup>
                {filteredBanks.map((bank) => (
                  <CommandItem
                    key={bank.id}
                    value={bank.name}
                    onSelect={() => handleSelect(bank.id)}
                    className="text-white aria-selected:bg-slate-800"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === bank.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {bank.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}