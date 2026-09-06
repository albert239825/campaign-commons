// OWNER: Frontend A (race table).
import Link from "next/link";
import Image from "next/image";
import { getRaces, getTrails, hasTrails } from "@/lib/data";
import { date, routes } from "@/lib/format";
import { DataStatusBanner } from "@/components/ui";
import { BarLegend, MONEY_COLORS } from "@/components/ui/stacked-bar";
import { RaceTable } from "@/components/race-table/race-table";
import { LandingAsk } from "@/components/home/landing-ask";

export default function RaceTablePage() {
  const { races, generated_at } = getRaces();
  const live = races.filter((r) => r.status !== "stub");
  const askRaces = live.map((r) => ({ race_id: r.race_id, label: r.label }));
  const askExamples = askRaces[0] && hasTrails(askRaces[0].race_id) ? getTrails(askRaces[0].race_id).examples.slice(0, 4) : [];
  const worst = live.some((r) => r.data_status === "mock") ? "mock" : live.some((r) => r.data_status === "partial") ? "partial" : "real";
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <h1 id="landing-title">
            Follow the money.<br />See the whole picture.
          </h1>
          <p className="landing-description">
            Explore the money behind political campaigns, the people funding them,
            and where the public record ends. Follow every connection back to its source.
          </p>
          <div className="landing-actions">
            <a href="#races" className="landing-primary">Explore the races <span aria-hidden="true">↓</span></a>
            <Link href={routes.methodology()} className="landing-secondary">How we follow the money <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <div className="landing-art" aria-hidden="true">
          <Image
            src="/images/landing-capitol.png"
            alt=""
            width={1536}
            height={1024}
            sizes="(max-width: 680px) 660px, (max-width: 1080px) 100vw, 1040px"
            priority
          />
        </div>
        <div className="landing-fade" aria-hidden="true" />
      </section>

      <section id="races" className="landing-races" aria-labelledby="races-title">
        <div className="landing-races-heading">
          <h2 id="races-title">Start with a race.</h2>
          <p>Campaign finances, outside spending, and the sources behind them. Choose a race to explore the records.</p>
        </div>
        <DataStatusBanner status={worst} />
        <div className="landing-table-label">
          <span>Explore the races</span>
          <BarLegend
            segments={[
              { label: "Campaign receipts", value: 1, color: MONEY_COLORS.campaign },
              { label: "Outside spending", value: 1, color: MONEY_COLORS.outside },
            ]}
          />
        </div>
        <RaceTable races={races} />
        <p className="landing-method-note">
          Traceability is the share of outside dollars that resolve to a named source (an individual, business or union) after
          walking committee-to-committee transfers backward. Preliminary; see <Link href={routes.methodology()}>methodology</Link>.
          {" "}Index generated {date(generated_at.slice(0, 10))}.
        </p>
      </section>
      <LandingAsk races={askRaces} examples={askExamples} />
    </div>
  );
}
