/**
 * The courteous mobile refusal.
 *
 * A dead end: nothing to press, nothing to wait for. It fires before the boot
 * splash — a member who won't get in shouldn't be made to watch the press warm
 * up. Its one job is to name itself while it declines, in the app's own voice.
 */
import { copy } from '../copy';
import { Corners } from './primitives';

export function MobileGate({ onContinue }: { onContinue?: () => void }) {
  return (
    <div className="mobile-gate">
      <div className="plate">
        <Corners />
        <div className="wordmark">{copy.appName}</div>
        <p>{copy.mobileGate.body}</p>
        {/*
          * Only a personal copy offers the way through, and it is offered
          * *after* the refusal rather than beside it: the advice is sound and
          * should be read before it is waved away.
          */}
        {onContinue && (
          <button className="btn sm" onClick={onContinue}>
            {copy.mobileGate.continueAnyway}
          </button>
        )}
      </div>
    </div>
  );
}
