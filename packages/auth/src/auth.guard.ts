import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import Shopify from '@shopify/shopify-api';
import type { IncomingMessage, ServerResponse } from 'http';
import { SHOPIFY_ACCESS_MODE } from './auth.constants';
import { ReauthHeaderException, ReauthRedirectException } from './auth.errors';
import { AccessMode } from './auth.interfaces';

@Injectable()
export class ShopifyAuthGuard implements CanActivate {
  constructor(
    @Inject(SHOPIFY_ACCESS_MODE)
    private readonly accessMode: AccessMode
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const res = http.getResponse<ServerResponse>();

    const isOnline = this.accessMode === AccessMode.Online;
    const session = await Shopify.Utils.loadCurrentSession(req, res, isOnline);

    if (session) {
      const scopesChanged = !Shopify.Context.SCOPES.equals(session.scope);

      if (
        !scopesChanged &&
        session.accessToken &&
        (!session.expires || new Date(session.expires) >= new Date())
      ) {
        return true;
      }
    }

    let shop: string | undefined;
    let authHeader: string | undefined;
    if (Shopify.Context.IS_EMBEDDED_APP) {
      authHeader = req.headers.authorization;
    }

    if (authHeader) {
      if (session) {
        shop = session.shop;
      } else if (authHeader) {
        const matches = authHeader?.match(/Bearer (.*)/);
        if (matches) {
          const payload = Shopify.Utils.decodeSessionToken(matches[1]);
          shop = payload.dest.replace('https://', '');
        }
      }

      if (shop) {
        throw new ReauthHeaderException(shop);
      }
    } else if (!isOnline) {
      const query = Object.fromEntries(new URLSearchParams(req.url).entries());
      shop = query['shop']?.toString();

      if (shop) {
        throw new ReauthRedirectException(shop);
      }

      throw new BadRequestException('Missing query parameter shop');
    }

    throw new UnauthorizedException(
      'Missing or malformed Authorization header'
    );
  }
}
