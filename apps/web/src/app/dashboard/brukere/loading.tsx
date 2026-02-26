export default function BrukereLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-7 w-32 bg-dark-700 rounded mb-2" />
          <div className="h-4 w-56 bg-dark-700/50 rounded" />
        </div>
        <div className="h-10 w-32 bg-dark-700 rounded-xl" />
      </div>

      <div className="glass-card overflow-hidden">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 p-4 border-b border-dark-700/50">
            <div className="w-10 h-10 rounded-full bg-dark-700" />
            <div className="flex-1">
              <div className="h-4 w-36 bg-dark-700 rounded mb-1" />
              <div className="h-3 w-48 bg-dark-700/50 rounded" />
            </div>
            <div className="h-6 w-16 bg-dark-700/50 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
