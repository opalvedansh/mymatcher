import { useCallback } from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ChatScreen } from '@/screens/main/shared/ChatScreen';
import { HIDDEN_TAB_BAR_STYLE, TAB_BAR_STYLE } from '@/theme/tabBar';

export default function MessagesRoute() {
  const navigation = useNavigation();
  const router = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();

  // The floating tab bar would cover the message box, so hide it while a chat is open.
  const handleConversationState = useCallback((isOpen: boolean) => {
    navigation.setOptions({ tabBarStyle: isOpen ? HIDDEN_TAB_BAR_STYLE : TAB_BAR_STYLE } as any);
  }, [navigation]);

  // Clear the param so returning to this tab later doesn't reopen the same chat.
  const clearMatchParam = useCallback(() => {
    router.setParams({ matchId: undefined });
  }, [router]);

  return (
    <ChatScreen
      onConversationStateChange={handleConversationState}
      initialMatchId={matchId}
      onInitialMatchOpened={clearMatchParam}
    />
  );
}
