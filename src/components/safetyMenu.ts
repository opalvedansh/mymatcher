import { showAlert } from '@/components/ActionSheet';
import { blockUser, reportContent, type ReportReason, type ReportTargetType } from '@/api';

const REPORT_REASONS: { label: string; value: ReportReason }[] = [
  { label: 'Spam', value: 'spam' },
  { label: 'Inappropriate content', value: 'inappropriate' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Fake profile', value: 'fake_profile' },
  { label: 'Something else', value: 'other' },
];

const TARGET_LABEL: Record<ReportTargetType, string> = {
  user: 'profile',
  post: 'post',
  story: 'story',
  message: 'conversation',
};

function askReportReason(targetType: ReportTargetType, targetId: string) {
  showAlert(`Report ${TARGET_LABEL[targetType]}`, 'Why are you reporting this?', [
    ...REPORT_REASONS.map(({ label, value }) => ({
      text: label,
      onPress: async () => {
        try {
          await reportContent(targetType, targetId, value);
          showAlert('Thanks for letting us know', 'Our team will review this report.');
        } catch {
          showAlert('Report failed', 'Please try again.');
        }
      },
    })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}

function confirmBlock(userId: string, name: string, onBlocked?: () => void) {
  showAlert(
    `Block ${name}?`,
    "They won't be able to see your profile, posts or stories, and your conversation will end.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(userId);
            onBlocked?.();
          } catch {
            showAlert('Block failed', 'Please try again.');
          }
        },
      },
    ],
  );
}

/**
 * Report/Block menu for content created by another user.
 * `target` is what gets reported; the block always applies to `userId`.
 */
export function openSafetyMenu({
  userId,
  name,
  target,
  onBlocked,
}: {
  userId: string;
  name: string;
  target: { type: ReportTargetType; id: string };
  onBlocked?: () => void;
}) {
  showAlert(name, undefined, [
    { text: `Report ${TARGET_LABEL[target.type]}`, icon: 'flag-outline', onPress: () => askReportReason(target.type, target.id) },
    { text: `Block ${name}`, icon: 'ban-outline', style: 'destructive', onPress: () => confirmBlock(userId, name, onBlocked) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/** Menu for the signed-in user's own profile: sign out or delete the account. */
export function openAccountMenu({
  signOut,
  deleteAccount,
  email,
}: {
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  email?: string | null;
}) {
  showAlert('Account', email ? `Signed in as ${email}` : undefined, [
    { text: 'Sign out', icon: 'log-out-outline', onPress: () => { signOut(); } },
    {
      text: 'Delete account',
      icon: 'trash-outline',
      style: 'destructive',
      onPress: () =>
        showAlert(
          'Delete your account?',
          'This permanently deletes your profile, photos, matches and messages. This cannot be undone.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete permanently',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteAccount();
                } catch {
                  showAlert('Could not delete account', 'Please check your connection and try again.');
                }
              },
            },
          ],
        ),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
