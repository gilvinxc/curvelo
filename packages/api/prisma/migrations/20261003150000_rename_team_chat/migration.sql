-- Rename the default "Team chat" channel to "Team Huddle".
UPDATE "Conversation" SET title = 'Team Huddle' WHERE kind = 'TEAM_CHAT' AND title = 'Team chat';
