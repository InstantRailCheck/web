"use client";

import { useEffect, useId, useRef, useState } from "react";
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

export type Bank = {
  id: string;
  slug: string;
  name: string;
};

export type BankCandidate = Bank & {
  city: string | null;
  state: string | null;
  sourceAuthority: "fdic" | "ncua" | null;
};

export type AddBankOutcome = Bank | { ambiguous: true; candidates: BankCandidate[] };

type SearchResult = Bank & { city?: string | null; state?: string | null };

type BankSelectProps = {
  label: string;
  placeholder: string;
  initialBank?: Bank | null;
  onChange?: (bank: Bank | null) => void;
  onAdd?: (name: string) => Promise<AddBankOutcome>;
  centerLabel?: boolean;
  centerText?: boolean;
};

function regulatorLabel(sourceAuthority: BankCandidate["sourceAuthority"]): string | null {
  if (sourceAuthority === "fdic") return "FDIC";
  if (sourceAuthority === "ncua") return "NCUA";
  return null;
}

const SEARCH_DEBOUNCE_MS = 250;

export function BankSelect({
  label,
  placeholder,
  initialBank = null,
  onChange,
  onAdd,
  centerLabel = false,
  centerText = false,
}: BankSelectProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(initialBank);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<BankCandidate[] | null>(null);
  const openedFetchedRef = useRef(false);

  // Fetches immediately the moment the popover opens (so it isn't empty on
  // first click), then debounces on every subsequent keystroke while open.
  // loading itself is flipped on by the event handlers below (typing,
  // opening) rather than here, so it's visible during the debounce wait
  // itself, not just once the network request starts — otherwise the list
  // just sits there showing stale (pre-keystroke) results with no
  // indication a new search is even queued.
  useEffect(() => {
    if (!open) {
      openedFetchedRef.current = false;
      return;
    }

    const isFirstFetch = !openedFetchedRef.current;
    const controller = new AbortController();

    const handle = setTimeout(
      async () => {
        openedFetchedRef.current = true;
        try {
          const res = await fetch(`/api/bank-search?q=${encodeURIComponent(search.trim())}`, {
            signal: controller.signal,
          });
          const data = await res.json();
          setResults(data.banks ?? []);
        } catch (err) {
          if ((err as Error).name !== "AbortError") console.error(err);
        } finally {
          setLoading(false);
        }
      },
      isFirstFetch ? 0 : SEARCH_DEBOUNCE_MS
    );

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [search, open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setLoading(true);
    else setAmbiguousCandidates(null);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setLoading(true);
    setAmbiguousCandidates(null);
  }

  function handleSelect(bank: Bank) {
    const next = selectedBank?.id === bank.id ? null : bank;
    setSelectedBank(next);
    onChange?.(next);
    setOpen(false);
    setSearch("");
  }

  async function handleAdd() {
    if (!onAdd || !search.trim()) return;
    setAdding(true);
    try {
      const outcome = await onAdd(search.trim());
      if ("ambiguous" in outcome) {
        setAmbiguousCandidates(outcome.candidates);
        return;
      }
      setSelectedBank(outcome);
      onChange?.(outcome);
      setOpen(false);
      setSearch("");
    } finally {
      setAdding(false);
    }
  }

  function handleSelectCandidate(candidate: BankCandidate) {
    const bank: Bank = { id: candidate.id, slug: candidate.slug, name: candidate.name };
    setSelectedBank(bank);
    onChange?.(bank);
    setAmbiguousCandidates(null);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="block">
      <span id={labelId} className={cn("mb-2 block text-sm font-medium text-slate-300", centerLabel && "text-center")}>
        {label}
      </span>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelId}
            className={cn(
              "w-full rounded-xl border-slate-700 bg-slate-950 px-4 py-6 text-white hover:bg-slate-900 hover:text-white",
              centerText ? "justify-center text-center" : "justify-between text-left"
            )}
          >
            {selectedBank ? selectedBank.name : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] border-slate-800 bg-slate-950 p-0 text-white">
          <Command className="bg-slate-950 text-white" shouldFilter={false}>
            <CommandInput placeholder="Search banks..." onValueChange={handleSearchChange} />
            <CommandList>
              {ambiguousCandidates ? (
                <div className="p-1">
                  <div className="px-2 py-1.5 text-xs text-slate-400">
                    Multiple institutions share this name — which one?
                  </div>
                  {ambiguousCandidates.map((candidate) => {
                    const regulator = regulatorLabel(candidate.sourceAuthority);
                    const location = [candidate.city, candidate.state].filter(Boolean).join(", ");
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => handleSelectCandidate(candidate)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm text-white hover:bg-slate-800"
                      >
                        <span>{candidate.name}</span>
                        {(location || regulator) && (
                          <span className="text-xs text-slate-400">
                            {[location, regulator].filter(Boolean).join(" — ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  {loading && (
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500">
                      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-slate-400" />
                      Searching...
                    </div>
                  )}
                  <CommandEmpty>
                    {!loading &&
                      (onAdd && search.trim() ? (
                        <button
                          onClick={handleAdd}
                          disabled={adding}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        >
                          {adding ? "Adding..." : `+ Add "${search.trim()}"`}
                        </button>
                      ) : (
                        "No bank found."
                      ))}
                  </CommandEmpty>
                </>
              )}
              <CommandGroup className={cn(loading && "opacity-40", ambiguousCandidates && "hidden")}>
                {results.map((bank) => {
                  // Only show city/state when this exact name appears more
                  // than once in the current results — duplicate-legal-name
                  // charters are common in this dataset, and without some
                  // way to tell them apart a user could silently pick the
                  // wrong one. The common case (a uniquely-named result)
                  // just shows the bank name, per feedback that location
                  // was cluttering every row.
                  const isDuplicateName = results.filter((r) => r.name === bank.name).length > 1;
                  const location = isDuplicateName ? [bank.city, bank.state].filter(Boolean).join(", ") : "";
                  return (
                    <CommandItem
                      key={bank.id}
                      value={bank.name}
                      onSelect={() => handleSelect(bank)}
                      className="text-white aria-selected:bg-slate-800"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedBank?.id === bank.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {bank.name}
                      {location && <span className="ml-2 text-xs text-slate-500">{location}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
