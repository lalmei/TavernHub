import { z } from 'zod';

export const tokenRoleSchema = z.enum(['player', 'npc', 'dm_marker']);

export const visionSchema = z.object({
  enabled: z.boolean(),
  radius: z.number().min(0).max(5000),
  shape: z.literal('circle')
});

export const tokenSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().min(1).max(100),
  x: z.number(),
  y: z.number(),
  size: z.number().positive(),
  role: tokenRoleSchema,
  vision: visionSchema,
  visible: z.boolean(),
  imageUrl: z.string().min(1).nullable()
});

export const createSessionSchema = z.object({
  name: z.string().min(1).max(120).default('New Session')
});

export const mapSchema = z.object({
  imageUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  gridSize: z.number().int().positive().nullable().optional()
});

export const sceneSchema = z.object({
  sessionId: z.string().min(1),
  fogEnabled: z.boolean(),
  globalLight: z.boolean()
});

const uvttPointSchema = z.object({ x: z.number(), y: z.number() });

const portalBoundsSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([uvttPointSchema, uvttPointSchema]),
  z.array(z.number()).min(2),
  z.array(uvttPointSchema).min(2)
]);

export const universalVttSchema = z.object({
  format: z.number().min(0.1).max(1),
  resolution: z.object({
    map_origin: z.object({
      x: z.number(),
      y: z.number()
    }),
    map_size: z.object({
      x: z.number().positive(),
      y: z.number().positive()
    }),
    pixels_per_grid: z.number().positive()
  }),
  image: z.string().optional(),
  line_of_sight: z.array(z.array(uvttPointSchema)).default([]),
  portals: z
    .array(
      z.object({
        bounds: portalBoundsSchema,
        closed: z.boolean().optional()
      })
    )
    .default([]),
  lights: z
    .array(
      z.object({
        position: z.object({ x: z.number(), y: z.number() }),
        range: z.number().nonnegative(),
        intensity: z.number().optional(),
        color: z.string().optional()
      })
    )
    .default([]),
  extensions: z
    .object({
      auvtt: z
        .object({
          scene: z
            .object({
              fogEnabled: z.boolean().optional(),
              globalLight: z.boolean().optional()
            })
            .optional(),
          tokens: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                x: z.number(),
                y: z.number(),
                size: z.number().positive(),
                role: tokenRoleSchema,
                vision: visionSchema,
                visible: z.boolean(),
                imageUrl: z.string().min(1).nullable().optional()
              })
            )
            .optional()
        })
        .optional()
    })
    .optional()
});

export const moveTokenSchema = z.object({
  sessionId: z.string().min(1),
  id: z.string().min(1),
  x: z.number(),
  y: z.number()
});

export const uploadMapSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  gridSize: z.number().int().positive().nullable().optional()
});
