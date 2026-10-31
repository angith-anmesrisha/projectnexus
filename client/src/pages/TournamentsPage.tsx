import { useParams, useSearchParams } from 'react-router-dom';
import { Shield, Trophy } from 'lucide-react';
import { TeamsPanel } from '../components/TeamsPanel';
import { TournamentDetail, TournamentList } from '../components/Tournaments';

export function TournamentsPage() {
  const { tournamentId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'teams' ? 'teams' : 'tournaments';

  if (tournamentId) {
    return (
      <div className="workspace single">
        <section className="main glass">
          <TournamentDetail key={tournamentId} id={tournamentId} />
        </section>
      </div>
    );
  }

  return (
    <div className="workspace single">
      <section className="main glass">
        <div className="page">
          <header className="compete-hero">
            <div>
              <p className="eyebrow">Compete</p>
              <h1>Tournaments and teams</h1>
              <p className="muted">Brackets from every community you're in, and the squads you play them with.</p>
            </div>
            <div className="seg">
              <button className={tab === 'tournaments' ? 'on' : ''} onClick={() => setParams({})}><Trophy size={14} /> Tournaments</button>
              <button className={tab === 'teams' ? 'on' : ''} onClick={() => setParams({ tab: 'teams' })}><Shield size={14} /> Teams</button>
            </div>
          </header>
          {tab === 'teams' ? <TeamsPanel /> : <TournamentList />}
        </div>
      </section>
    </div>
  );
}
