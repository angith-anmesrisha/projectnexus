import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import type { Community } from '../lib/types';

/** Opening an invite link joins the community straight away. */
export function InvitePage() {
  const { code } = useParams();
  const { setCommunityDetail } = useNexus();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .post<{ community: Community }>('/communities/join', { inviteCode: code })
      .then((r) => {
        setCommunityDetail(r.community);
        navigate(`/communities/${r.community.id}`, { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [code, navigate, setCommunityDetail]);

  return (
    <div className="empty">
      {error ? (
        <>
          <p className="form-error">{error}</p>
          <Link to="/communities" className="btn">Back to communities</Link>
        </>
      ) : (
        <p className="muted">Joining…</p>
      )}
    </div>
  );
}
