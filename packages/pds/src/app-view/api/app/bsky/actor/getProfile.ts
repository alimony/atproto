import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../../../../../lexicon'
import { softDeleted } from '../../../../../db/util'
import AppContext from '../../../../../context'
import { OutputSchema } from '../../../../../lexicon/types/app/bsky/actor/getProfile'
import { handleReadAfterWrite } from '../util/read-after-write'
import { LocalRecords } from '../../../../../services/local'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.actor.getProfile({
    auth: ctx.accessVerifier,
    handler: async ({ req, auth, params }) => {
      const requester = auth.credentials.did
      if (ctx.canProxyRead(req)) {
        const res = await ctx.appviewAgent.api.app.bsky.actor.getProfile(
          params,
          await ctx.serviceAuthHeaders(requester),
        )
        if (res.data.did === requester) {
          return await handleReadAfterWrite(
            ctx,
            requester,
            res,
            getProfileMunge,
          )
        }
        return {
          encoding: 'application/json',
          body: res.data,
        }
      }

      const { actor } = params
      const { db, services } = ctx
      const actorService = services.appView.actor(db)

      const actorRes = await actorService.getActor(actor, true)

      if (!actorRes) {
        throw new InvalidRequestError('Profile not found')
      }
      if (softDeleted(actorRes)) {
        throw new InvalidRequestError(
          'Account has been taken down',
          'AccountTakedown',
        )
      }
      const profile = await actorService.views.profileDetailed(
        actorRes,
        requester,
      )
      if (!profile) {
        throw new InvalidRequestError('Profile not found')
      }

      return {
        encoding: 'application/json',
        body: profile,
      }
    },
  })
}

const getProfileMunge = async (
  ctx: AppContext,
  original: OutputSchema,
  local: LocalRecords,
): Promise<OutputSchema> => {
  if (!local.profile) return original
  return ctx.services
    .local(ctx.db)
    .updateProfileDetailed(original, local.profile.record)
}
