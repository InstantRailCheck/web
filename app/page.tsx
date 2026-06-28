export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="text-6xl font-bold mb-4">
          InstantRailCheck
        </h1>

        <p className="text-xl text-slate-300 mb-10">
          Know before you transfer.
        </p>

        <button className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-xl text-lg font-semibold transition">
          Check a Route
        </button>
      </div>
    </main>
  );
}