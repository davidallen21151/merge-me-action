/**
 * @webhook-pragma pull_request
 */

import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { OK } from 'http-status-codes';
import * as nock from 'nock';

import { useSetTimeoutImmediateInvocation } from '../../../test/utilities';
import { mergePullRequestMutation } from '../../graphql/mutations';
import { AllowedMergeMethods } from '../../utilities/inputParsers';
import { pullRequestHandle } from '.';

/* cspell:disable-next-line */
const PULL_REQUEST_ID = 'MDExOlB1bGxSZXF1ZXN0MzE3MDI5MjU4';
const COMMIT_HEADLINE = 'Update test';

const octokit = getOctokit('SECRET_GITHUB_TOKEN');
const infoSpy = jest.spyOn(core, 'info').mockImplementation();
const warningSpy = jest.spyOn(core, 'warning').mockImplementation();
const debugSpy = jest.spyOn(core, 'debug').mockImplementation();
const getInputSpy = jest.spyOn(core, 'getInput').mockImplementation();

jest.spyOn(core, 'info').mockImplementation();

beforeEach((): void => {
  getInputSpy.mockImplementation((name: string): string => {
    if (name === 'MERGE_METHOD') {
      return 'SQUASH';
    }

    if (name === 'PRESET') {
      return 'DEPENDABOT_MINOR';
    }

    return '';
  });
});

describe('pull request event handler', (): void => {
  describe('for a user initiated pull request', (): void => {
    it('does not log warnings when it is triggered', async (): Promise<
      void
    > => {
      expect.assertions(1);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(OK, {
          data: {
            repository: {
              pullRequest: {
                commits: {
                  edges: [
                    {
                      node: {
                        commit: {
                          message: COMMIT_HEADLINE,
                        },
                      },
                    },
                  ],
                },
                id: PULL_REQUEST_ID,
                mergeable: 'MERGEABLE',
                merged: false,
                reviews: {
                  edges: [
                    {
                      node: {
                        state: 'APPROVED',
                      },
                    },
                  ],
                },
                state: 'OPEN',
              },
            },
          },
        });
      nock('https://api.github.com').post('/graphql').reply(OK);

      await pullRequestHandle(octokit, 'dependabot-preview[bot]', 2);

      expect(warningSpy).not.toHaveBeenCalled();
    });

    it('does nothing if response is null', async (): Promise<void> => {
      expect.assertions(0);

      nock('https://api.github.com').post('/graphql').reply(OK, {
        data: null,
      });

      await pullRequestHandle(octokit, 'dependabot-preview[bot]', 2);
    });

    it('does not approve an already approved pull request', async (): Promise<
      void
    > => {
      expect.assertions(0);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(OK, {
          data: {
            repository: {
              pullRequest: {
                commits: {
                  edges: [
                    {
                      node: {
                        commit: {
                          message: COMMIT_HEADLINE,
                        },
                      },
                    },
                  ],
                },
                id: PULL_REQUEST_ID,
                mergeable: 'MERGEABLE',
                merged: false,
                reviews: {
                  edges: [
                    {
                      node: {
                        state: 'APPROVED',
                      },
                    },
                  ],
                },
                state: 'OPEN',
              },
            },
          },
        });
      nock('https://api.github.com')
        .post('/graphql', {
          query: mergePullRequestMutation(AllowedMergeMethods.SQUASH),
          variables: {
            commitHeadline: COMMIT_HEADLINE,
            pullRequestId: PULL_REQUEST_ID,
          },
        })
        .reply(OK);

      await pullRequestHandle(octokit, 'dependabot-preview[bot]', 2);
    });

    it('retries up to two times before failing', async (): Promise<void> => {
      expect.assertions(5);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(OK, {
          data: {
            repository: {
              pullRequest: {
                commits: {
                  edges: [
                    {
                      node: {
                        commit: {
                          message: COMMIT_HEADLINE,
                        },
                      },
                    },
                  ],
                },
                id: PULL_REQUEST_ID,
                mergeable: 'MERGEABLE',
                merged: false,
                reviews: {
                  edges: [
                    {
                      node: {
                        state: 'APPROVED',
                      },
                    },
                  ],
                },
                state: 'OPEN',
              },
            },
          },
        })
        .post('/graphql')
        .times(3)
        .reply(
          403,
          '##[error]GraphqlError: Base branch was modified. Review and try the merge again.',
        );

      useSetTimeoutImmediateInvocation();

      await pullRequestHandle(octokit, 'dependabot-preview[bot]', 2);

      expect(infoSpy).toHaveBeenCalledWith(
        'An error ocurred while merging the Pull Request. This is usually caused by the base branch being out of sync with the target branch. In this case, the base branch must be rebased. Some tools, such as Dependabot, do that automatically.',
      );
      expect(infoSpy).toHaveBeenCalledWith('Retrying in 1000...');
      expect(infoSpy).toHaveBeenCalledWith('Retrying in 4000...');
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith(
        'Original error: HttpError: ##[error]GraphqlError: Base branch was modified. Review and try the merge again..',
      );
    });

    it('fails the backoff strategy when the error is not "Base branch was modified"', async (): Promise<
      void
    > => {
      expect.assertions(2);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(OK, {
          data: {
            repository: {
              pullRequest: {
                commits: {
                  edges: [
                    {
                      node: {
                        commit: {
                          message: COMMIT_HEADLINE,
                        },
                      },
                    },
                  ],
                },
                id: PULL_REQUEST_ID,
                mergeable: 'MERGEABLE',
                merged: false,
                reviews: {
                  edges: [
                    {
                      node: {
                        state: 'APPROVED',
                      },
                    },
                  ],
                },
                state: 'OPEN',
              },
            },
          },
        })
        .post('/graphql')
        .reply(403, '##[error]GraphqlError: This is a different error.');

      await pullRequestHandle(octokit, 'dependabot-preview[bot]', 2);

      expect(infoSpy).toHaveBeenCalledWith(
        'An error ocurred while merging the Pull Request. This is usually caused by the base branch being out of sync with the target branch. In this case, the base branch must be rebased. Some tools, such as Dependabot, do that automatically.',
      );
      expect(debugSpy).toHaveBeenCalledWith(
        'Original error: HttpError: ##[error]GraphqlError: This is a different error..',
      );
    });
  });
});
