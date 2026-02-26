import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';

export const metadata: Metadata = {
  title: {
    default: 'Dashboard',
    template: '%s | Skyplanner',
  },
  robots: 'noindex,nofollow',
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, organization } = await requireAuth();

  return (
    <div className="min-h-screen">
      <a href="#main-content" className="skip-to-content">
        Hopp til hovedinnhold
      </a>

      {/* Mountain Silhouettes */}
      <div className="mountains-container" aria-hidden="true">
        <svg
          className="mountain-layer mountain-far"
          viewBox="0 0 1920 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="d-mtn-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--sky-mountain-far, #1A2436)" />
              <stop offset="100%" stopColor="#141C2A" />
            </linearGradient>
            <filter id="d-ridge">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
            </filter>
          </defs>
          <path
            d="M0,400 L0,280 C40,275 80,258 120,238 C160,218 195,198 235,190 C275,182 310,205 350,225 C380,240 410,230 450,205 C490,180 520,165 570,152 C620,140 650,168 695,195 C735,220 765,210 800,185 C840,160 870,148 910,138 C950,128 985,155 1025,180 C1065,205 1095,190 1135,165 C1175,140 1205,125 1255,118 C1305,112 1335,135 1375,165 C1415,195 1445,210 1485,200 C1525,190 1555,175 1595,158 C1635,142 1675,155 1715,180 C1755,205 1795,225 1840,245 C1870,260 1900,278 1920,285 L1920,400 Z"
            fill="url(#d-mtn-far)"
          />
          <path
            className="ridge-glow"
            d="M0,280 C40,275 80,258 120,238 C160,218 195,198 235,190 C275,182 310,205 350,225 C380,240 410,230 450,205 C490,180 520,165 570,152 C620,140 650,168 695,195 C735,220 765,210 800,185 C840,160 870,148 910,138 C950,128 985,155 1025,180 C1065,205 1095,190 1135,165 C1175,140 1205,125 1255,118 C1305,112 1335,135 1375,165 C1415,195 1445,210 1485,200 C1525,190 1555,175 1595,158 C1635,142 1675,155 1715,180 C1755,205 1795,225 1840,245 C1870,260 1900,278 1920,285"
            fill="none"
            stroke="rgba(74, 222, 128, 0.18)"
            strokeWidth="3"
            filter="url(#d-ridge)"
          />
        </svg>
        <div className="mountain-fog mountain-fog--far"></div>
        <svg
          className="mountain-layer mountain-mid"
          viewBox="0 0 1920 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0,400 L0,310 L50,298 L90,270 L120,245 L145,258 L175,232 L205,192 L235,170 L258,184 L285,210 L315,242 L345,260 L375,238 L415,198 L445,158 L468,142 L488,152 L515,178 L555,212 L585,232 L615,218 L645,188 L685,158 L718,132 L740,122 L758,134 L785,162 L825,198 L865,228 L895,242 L925,222 L955,188 L985,152 L1015,122 L1038,108 L1055,118 L1078,142 L1115,178 L1155,212 L1195,238 L1225,218 L1255,182 L1295,148 L1325,118 L1348,105 L1365,112 L1388,138 L1425,172 L1465,202 L1495,222 L1535,242 L1565,228 L1595,198 L1635,162 L1665,138 L1688,128 L1708,142 L1745,178 L1785,212 L1825,242 L1865,272 L1905,298 L1920,308 L1920,400 Z" />
        </svg>
        <div className="mountain-fog mountain-fog--mid"></div>
        <svg
          className="mountain-layer mountain-near"
          viewBox="0 0 1920 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0,400 L0,342 L28,332 L48,312 L68,325 L88,308 L108,278 L128,252 L142,238 L155,248 L168,262 L188,282 L208,298 L238,312 L268,292 L288,268 L308,242 L322,222 L338,198 L348,178 L356,162 L364,172 L374,192 L388,218 L408,242 L438,268 L468,288 L498,298 L528,282 L552,262 L572,242 L588,228 L602,212 L614,202 L622,192 L628,198 L642,218 L662,248 L688,272 L718,298 L748,312 L778,322 L808,308 L838,282 L858,262 L878,242 L892,228 L904,218 L912,208 L918,212 L928,228 L948,248 L972,272 L998,292 L1028,308 L1058,318 L1088,302 L1108,282 L1128,262 L1148,242 L1162,228 L1172,212 L1182,198 L1188,188 L1194,195 L1205,212 L1222,238 L1248,262 L1278,288 L1308,302 L1338,312 L1368,298 L1392,278 L1412,258 L1428,242 L1442,228 L1454,218 L1462,208 L1468,198 L1474,205 L1485,222 L1502,248 L1528,272 L1558,292 L1588,312 L1618,328 L1648,318 L1678,298 L1698,278 L1718,262 L1732,252 L1745,242 L1755,238 L1762,242 L1775,262 L1798,288 L1828,312 L1858,332 L1888,348 L1920,358 L1920,400 Z" />
        </svg>
      </div>

      <div className="flex min-h-screen relative z-10">
        {/* Sidebar */}
        <Sidebar organization={organization} />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col lg:ml-64">
          {/* Header */}
          <DashboardHeader user={user} organization={organization} />

          {/* Page Content */}
          <main id="main-content" className="flex-1 p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">{children}</div>
          </main>
        </div>
      </div>

      {/* Mobile Sidebar Overlay - handled by Sidebar client component */}
    </div>
  );
}
