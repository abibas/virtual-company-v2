import { useState } from 'react';
import { ApiContext } from '../../api/context.ts';
import { useLocation } from '../../app/router.tsx';
import { CreateCompanyScreen } from '../../components/company/CreateCompanyScreen.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { SAMPLE_ME, sampleApi } from './records.ts';
import { sampleLogoFile } from './sample.ts';

/**
 * The create-company page on the sample API (creating is refused), as the first company. `?name=` starts with a
 * name typed, `?logo=1` with the sample logo picked, and `?crop=1` in the crop step on the wide sample logo.
 */
export function NewCompanyMock() {
  const [api] = useState(sampleApi);
  const { search } = useLocation();
  const [start] = useState(() => {
    const crop = search.get('crop') === '1';
    return {
      name: search.get('name') ?? '',
      ...(crop || search.get('logo') === '1' ? { logo: () => sampleLogoFile(crop), crop } : {}),
    };
  });
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
