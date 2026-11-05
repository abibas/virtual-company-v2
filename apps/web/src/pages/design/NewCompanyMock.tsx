import { useState } from 'react';
import { ApiContext } from '../../api/context.ts';
import { useLocation } from '../../app/router.tsx';
import { CreateCompanyScreen } from '../../components/company/CreateCompanyScreen.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { SAMPLE_ME, sampleApi } from './records.ts';
import { sampleLogoFile } from './sample.ts';

/**
 * The create-company page on the sample API (creating is refused), as the first company. `?name=` starts with a
 * name typed and `?logo=1` with the sample logo picked, so the preview can be seen filled.
 */
export function NewCompanyMock() {
  const [api] = useState(sampleApi);
  const { search } = useLocation();
  const name = search.get('name') ?? '';
  const [start] = useState(() => ({
    name,
    ...(search.get('logo') === '1' ? { logo: sampleLogoFile } : {}),
  }));
  return (
    <ApiContext value={api}>
      <CreateCompanyScreen
        email={SAMPLE_ME.email}
        first
        start={start}
        corner={
          <Badge tone="input" variant="solid">
            Sample data
          </Badge>
        }
        onCreated={() => Promise.resolve()}
      />
    </ApiContext>
  );
}
