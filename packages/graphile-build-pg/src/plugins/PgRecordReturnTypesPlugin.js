// @flow
import type { Plugin } from "graphile-build";

export default (function PgRecordReturnTypesPlugin(builder) {
  builder.hook("init", (_, build) => {
    const {
      newWithHooks,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgGetGqlTypeByTypeIdAndModifier,
      graphql: { GraphQLObjectType },
      inflection,
      pgOmit: omit,
      describePgEntity,
      sqlCommentByAddingTags,
      pgSql: sql,
      pgGetSelectValueForFieldAndTypeAndModifier: getSelectValueForFieldAndTypeAndModifier,
    } = build;
    introspectionResultsByKind.procedure
      .filter(proc => !!proc.namespace)
      .filter(proc => !omit(proc, "execute"))
      .forEach(proc => {
        const returnType =
          introspectionResultsByKind.typeById[proc.returnTypeId];
        if (returnType.id !== "2249") {
          return;
        }
        const argModesWithOutput = [
          "o", // OUT,
          "b", // INOUT
          "t", // TABLE
        ];
        const outputArgNames = proc.argTypeIds.reduce(
          (prev, _, idx) =>
            argModesWithOutput.includes(proc.argModes[idx])
              ? [...prev, proc.argNames[idx] || ""]
              : prev,
          []
        );
        const outputArgTypes = proc.argTypeIds.reduce(
          (prev, typeId, idx) =>
            argModesWithOutput.includes(proc.argModes[idx])
              ? [...prev, introspectionResultsByKind.typeById[typeId]]
              : prev,
          []
        );
        newWithHooks(
          GraphQLObjectType,
          {
            name: inflection.functionReturnsRecordType(proc),
            description: `The return type of our \`${inflection.functionQueryName(
              proc
            )}\` query.`,
            fields: ({ fieldWithHooks }) => {
              return outputArgNames.reduce((memo, outputArgName, idx) => {
                const fieldName = inflection.functionOutputFieldName(
                  proc,
                  outputArgName,
                  idx + 1
                );
                const fieldType = pgGetGqlTypeByTypeIdAndModifier(
                  outputArgTypes[idx].id,
                  null
                );
                return {
                  ...memo,
                  [fieldName]: fieldWithHooks(
                    fieldName,
                    fieldContext => {
                      const { addDataGenerator } = fieldContext;
                      addDataGenerator(parsedResolveInfoFragment => {
                        return {
                          pgQuery: queryBuilder => {
                            queryBuilder.select(
                              getSelectValueForFieldAndTypeAndModifier(
                                fieldType,
                                fieldContext,
                                parsedResolveInfoFragment,
                                sql.fragment`(${queryBuilder.getTableAlias()}.${sql.identifier(
                                  // According to https://www.postgresql.org/docs/10/static/sql-createfunction.html,
                                  // "If you omit the name for an output argument, the system will choose a default column name."
                                  // In PG 9.x and 10, the column names appear to be assigned with a `column` prefix.
                                  outputArgName !== ""
                                    ? outputArgName
                                    : `column${idx + 1}`
                                )})`,
                                outputArgTypes[idx],
                                null
                              ),
                              fieldName
                            );
                          },
                        };
                      });
                      return {
                        type: fieldType,
                        resolve(data) {
                          // According to https://www.postgresql.org/docs/10/static/sql-createfunction.html,
                          // "If you omit the name for an output argument, the system will choose a default column name."
                          // In PG 9.x and 10, the column names appear to be assigned with a `column` prefix.
                          return outputArgName !== ""
                            ? data[fieldName]
                            : data.value[`column${idx + 1}`];
                        },
                      };
                    },
                    {}
                  ),
                };
              }, {});
            },
          },
          {
            __origin: `Adding record return type for ${describePgEntity(
              proc
            )}. You can rename the function's GraphQL field (and its dependent types) via:\n\n  ${sqlCommentByAddingTags(
              proc,
              {
                name: "newNameHere",
              }
            )}\n\nYou can rename just the function's GraphQL result type via:\n\n  ${sqlCommentByAddingTags(
              proc,
              {
                resultTypeName: "newNameHere",
              }
            )}`,
            isRecordReturnType: true,
            pgIntrospection: proc,
          }
        );
      });
    return _;
  });
}: Plugin);
