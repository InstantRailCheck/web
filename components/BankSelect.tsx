type Bank = {
  id: string;
  name: string;
};

type BankSelectProps = {
  label: string;
  placeholder: string;
  banks: Bank[];
};

export function BankSelect({ label, placeholder, banks }: BankSelectProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </span>

      <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400">
        <option value="">{placeholder}</option>
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.name}
          </option>
        ))}
      </select>
    </label>
  );
}