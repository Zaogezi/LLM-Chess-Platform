import type { ModelSetup } from '../../shared/protocol';
import {
  TOURNAMENT_MAX_GAMES_PER_PAIR,
  TOURNAMENT_MAX_MODELS,
  TOURNAMENT_MIN_MODELS,
} from '../../shared/protocol';
import type { ModelProfileLookup } from '../providers/validate';
import {
  ValidationError,
  validateApiReasoning,
  validateModelSetup,
  validateThinkingLevel,
} from '../providers/validate';

export interface TournamentEntrant {
  name: string;
  setup: ModelSetup;
}

export interface ValidatedTournamentStart {
  models: TournamentEntrant[];
  gamesPerPair: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateTournamentStartRequest(
  body: unknown,
  profiles?: ModelProfileLookup,
): ValidatedTournamentStart {
  const input = record(body);
  if (!input) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }

  const rawModels = input.models;
  if (!Array.isArray(rawModels)) {
    throw new ValidationError('models 必须是模型配置数组');
  }
  if (rawModels.length < TOURNAMENT_MIN_MODELS) {
    throw new ValidationError(`自动评测至少需要 ${TOURNAMENT_MIN_MODELS} 个模型`);
  }
  if (rawModels.length > TOURNAMENT_MAX_MODELS) {
    throw new ValidationError(`自动评测最多支持 ${TOURNAMENT_MAX_MODELS} 个模型`);
  }

  const names = new Set<string>();
  const models: TournamentEntrant[] = rawModels.map((raw, index) => {
    const item = record(raw);
    if (!item) {
      throw new ValidationError(`第 ${index + 1} 个模型配置缺失`);
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      throw new ValidationError(`请为第 ${index + 1} 个模型填写名称`);
    }
    if (name.length > 80) {
      throw new ValidationError(`第 ${index + 1} 个模型的名称过长`);
    }
    const normalized = name.toLocaleLowerCase();
    if (names.has(normalized)) {
      throw new ValidationError(`模型名称重复：${name}`);
    }
    names.add(normalized);

    let setup;
    if (Object.prototype.hasOwnProperty.call(item, 'profileId')) {
      if (!profiles) {
        throw new ValidationError(`第 ${index + 1} 个模型暂不支持模型库选择`);
      }
      const profileId = typeof item.profileId === 'string' ? item.profileId.trim() : '';
      if (!profileId) {
        throw new ValidationError(`请为第 ${index + 1} 个模型选择模型库配置`);
      }
      if (profileId.length > 128) {
        throw new ValidationError(`第 ${index + 1} 个模型的模型引用无效`);
      }
      const saved = profiles.resolveSetup(profileId);
      if (!saved) {
        throw new ValidationError(
          `第 ${index + 1} 个模型（${name}）的模型库配置已不存在，请重新选择`,
        );
      }
      setup = {
        ...saved,
        thinkingLevel:
          item.thinkingLevel === undefined
            ? saved.thinkingLevel
            : validateThinkingLevel(item.thinkingLevel),
        apiReasoning:
          item.apiReasoning === undefined
            ? Boolean(saved.apiReasoning)
            : validateApiReasoning(item.apiReasoning),
      };
    } else {
      setup = validateModelSetup(item, `第 ${index + 1} 个模型`);
    }

    return { name, setup };
  });

  const gamesPerPair = input.gamesPerPair;
  if (
    typeof gamesPerPair !== 'number' ||
    !Number.isInteger(gamesPerPair) ||
    gamesPerPair < 1 ||
    gamesPerPair > TOURNAMENT_MAX_GAMES_PER_PAIR
  ) {
    throw new ValidationError(
      `每对模型的对局数必须是 1 到 ${TOURNAMENT_MAX_GAMES_PER_PAIR} 之间的整数`,
    );
  }

  return { models, gamesPerPair };
}
