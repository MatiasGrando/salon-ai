import type { FastifyReply } from 'fastify'

export type AuthorizationFailure =
  | 'malformed'
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'conflict'

const authorizationFailures = {
  malformed: {
    statusCode: 400,
    body: { message: 'Solicitud invalida' }
  },
  unauthenticated: {
    statusCode: 401,
    body: { message: 'Necesitas iniciar sesion' }
  },
  forbidden: {
    statusCode: 403,
    body: { message: 'No tenes permiso para realizar esta accion' }
  },
  notFound: {
    statusCode: 404,
    body: { message: 'Recurso no encontrado' }
  },
  conflict: {
    statusCode: 409,
    body: { message: 'El recurso cambio de estado' }
  }
} as const satisfies Record<AuthorizationFailure, {
  statusCode: 400 | 401 | 403 | 404 | 409
  body: { message: string }
}>

export function authorizationFailure(failure: AuthorizationFailure) {
  return authorizationFailures[failure]
}

export function sendAuthorizationFailure(
  reply: FastifyReply,
  failure: AuthorizationFailure
) {
  const response = authorizationFailure(failure)
  return reply.status(response.statusCode).send(response.body)
}
