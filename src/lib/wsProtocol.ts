import { z } from 'zod';

const joinSession = z.object({
  type: z.literal('join_session'),
  payload: z.object({
    sessionId: z.string().min(1),
    role: z.enum(['dm', 'viewer'])
  })
});

const addToken = z.object({
  type: z.literal('add_token'),
  payload: z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string().min(1),
    x: z.number(),
    y: z.number(),
    size: z.number().positive(),
    role: z.enum(['player', 'npc', 'dm_marker']),
    vision: z.object({
      enabled: z.boolean(),
      radius: z.number().min(0),
      shape: z.literal('circle')
    }),
    visible: z.boolean()
  })
});

const updateToken = z.object({
  type: z.literal('update_token'),
  payload: addToken.shape.payload
});

const moveToken = z.object({
  type: z.literal('move_token'),
  payload: z.object({
    sessionId: z.string().min(1),
    id: z.string().min(1),
    x: z.number(),
    y: z.number()
  })
});

const deleteToken = z.object({
  type: z.literal('delete_token'),
  payload: z.object({
    sessionId: z.string().min(1),
    id: z.string().min(1)
  })
});

const updateScene = z.object({
  type: z.literal('update_scene_settings'),
  payload: z.object({
    sessionId: z.string().min(1),
    fogEnabled: z.boolean(),
    globalLight: z.boolean()
  })
});

export const clientMessageSchema = z.discriminatedUnion('type', [joinSession, addToken, updateToken, moveToken, deleteToken, updateScene]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(input: unknown): ParsedClientMessage {
  return clientMessageSchema.parse(input);
}
