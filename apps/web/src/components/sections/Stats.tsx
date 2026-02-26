const stats = [
  { value: '500+', label: 'Aktive brukere' },
  { value: '50 000+', label: 'Kunder registrert' },
  { value: '99.9%', label: 'Oppetid' },
  { value: '4.9/5', label: 'Kundetilfredshet' },
];

export default function Stats() {
  return (
    <section className="section">
      <div className="container-wide">
        <div className="glass-card p-8 sm:p-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold gradient-text mb-2">
                  {stat.value}
                </div>
                <div className="text-dark-400 text-sm sm:text-base">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
